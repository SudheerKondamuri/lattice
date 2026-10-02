import type { Database } from './db.js';
import { AppError } from './errors.js';
import { enqueue } from './util.js';
import { fence, type JobContext } from './ingestion.js';
import { createRun } from './evaluations.js';
import { publish, snapshot } from './releases.js';
import { deleteConversation } from './conversations.js';
export async function scheduleDaily(db: Database) {
  return db.system(async (tx) => {
    const day = await tx.one(
      'INSERT INTO schedule_days(day) VALUES(current_date) ON CONFLICT DO NOTHING RETURNING day',
    );
    if (!day) return;
    const workspaces = await tx.rows('SELECT id FROM workspaces');
    for (const w of workspaces) await enqueue(tx, w.id, 'maintenance', {});
  });
}
export async function maintain(db: Database, job: JobContext) {
  const w = job.workspaceId;
  return db.tenant(w, async (tx) => {
    await fence(tx, job);
    const expired = await tx.rows(
      "SELECT c.id FROM conversations c JOIN workspaces w ON w.id=c.workspace_id WHERE workspace_id=$1 AND c.updated_at<now()-w.retention_days*interval '1 day' LIMIT 1000",
      [w],
    );
    for (const c of expired) await deleteConversation(tx, w, c.id);
    await tx.exec('DELETE FROM sessions WHERE workspace_id=$1 AND expires_at<now()', [w]);
    const sources = await tx.rows(
      "SELECT id,draft_version_id FROM sources WHERE workspace_id=$1 AND status='active' AND kind IN ('website','sitemap') AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.workspace_id=sources.workspace_id AND j.kind='ingest' AND j.payload->>'sourceId'=sources.id::text AND j.state IN ('queued','running'))",
      [w],
    );
    const imports = [];
    for (const source of sources)
      imports.push({
        sourceId: source.id,
        before: source.draftVersionId,
        ...(await enqueue(tx, w, 'ingest', { sourceId: source.id })),
      });
    if (imports.length) await enqueue(tx, w, 'maintenance_review', { imports, phase: 'imports' }, null, 30);
    return { sourcesChecked: imports.length, transcriptsDeleted: expired.length };
  });
}
export async function maintenanceReview(db: Database, job: JobContext) {
  const w = job.workspaceId;
  return db.tenant(w, async (tx) => {
    await fence(tx, job);
    let summary = '';
    if (job.payload.phase === 'imports') {
      const ids = job.payload.imports.map((i: any) => i.jobId);
      const jobs = await tx.rows('SELECT id,state FROM jobs WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [
        w,
        ids,
      ]);
      if (jobs.some((j) => ['queued', 'running'].includes(j.state)))
        throw new AppError('WAITING_FOR_DEPENDENCIES', 'Imports are still running', 409);
      const changed = [];
      for (const imported of job.payload.imports) {
        const source = await tx.must('SELECT draft_version_id FROM sources WHERE workspace_id=$1 AND id=$2', [
          w,
          imported.sourceId,
        ]);
        if (source.draftVersionId !== imported.before) changed.push(imported.sourceId);
      }
      if (changed.length) {
        const agent = await tx.must('SELECT published_release_id FROM agents WHERE workspace_id=$1', [w]);
        const release = await snapshot(tx, w, 'Daily website changes');
        const cases = await tx.rows(
          `SELECT id FROM eval_cases WHERE workspace_id=$1 AND (input->>'control'='true' OR input->>'importance'='critical' OR jsonb_array_length(coalesce(input->'sourceIds','[]'))=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(input->'sourceIds') s WHERE s=ANY($2::text[]))) LIMIT 500`,
          [w, changed],
        );
        if (cases.length) {
          const run = await createRun(
            tx,
            w,
            release.id,
            cases.map((c) => c.id),
          );
          await enqueue(
            tx,
            w,
            'maintenance_review',
            {
              phase: 'checks',
              releaseId: release.id,
              checkJobId: run.jobId,
              baseReleaseId: agent.publishedReleaseId,
            },
            null,
            30,
          );
        }
        summary = `${changed.length} source updates staged; ${cases.length} affected/control checks queued. Publication awaits checks and review policy.`;
      } else
        summary = `Daily website check completed; ${jobs.filter((j) => j.state === 'failed').length} imports failed, no changed knowledge staged.`;
    } else {
      const evaluation = await tx.must('SELECT state FROM jobs WHERE workspace_id=$1 AND id=$2', [
        w,
        job.payload.checkJobId,
      ]);
      if (['queued', 'running'].includes(evaluation.state))
        throw new AppError('WAITING_FOR_DEPENDENCIES', 'Checks are still running', 409);
      try {
        await publish(
          tx,
          w,
          job.payload.releaseId,
          job.payload.baseReleaseId ?? null,
          false,
          null,
          'automatic',
        );
        summary = 'Ordinary website updates published under the configured automatic-publication policy.';
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        summary =
          'Website updates need owner review. Automatic publication is paused for checks, allowance, regressions, or approval-required knowledge.';
      }
    }
    await tx.exec(
      "INSERT INTO notifications(workspace_id,kind,summary,batch_key) VALUES($1,'maintenance',$2,'maintenance:'||current_date::text) ON CONFLICT(workspace_id,batch_key) DO UPDATE SET summary=left(notifications.summary||E'\n'||excluded.summary,4000)",
      [w, summary],
    );
    return { summary };
  });
}
