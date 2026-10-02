import { parse } from 'csv-parse/sync';
import type { Database, Tx } from './db.js';
import type { Config } from './config.js';
import type { AIProvider } from './providers.js';
import { AppError, publicError } from './errors.js';
import { enqueue, json } from './util.js';
import { caseInput } from './validation.js';
import { answerJob } from './answers.js';
import { fence, type JobContext } from './ingestion.js';
export const GRADING_LIMITATIONS = [
  'Model-assisted grades are preliminary, not accuracy measurements.',
  'Expected-fact matching is lexical and can flag valid paraphrases or miss contradictions.',
  'Source dependency detection is incomplete.',
  'Historical baselines may use older knowledge; human review is required, especially for critical cases.',
];
export async function createCase(tx: Tx, w: string, input: unknown, actor: string) {
  const value = caseInput.parse(input);
  const count = await tx.must('SELECT count(*)::int total FROM eval_cases WHERE workspace_id=$1', [w]);
  if (count.total >= 5000)
    throw new AppError('CASE_LIMIT', 'Workspace limit of 5,000 saved cases reached', 429);
  for (const id of value.sourceIds)
    await tx.must("SELECT id FROM sources WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'", [w, id]);
  const duplicates = await tx.rows(
    "SELECT input FROM eval_cases WHERE workspace_id=$1 AND regexp_replace(lower(input->>'question'),'[^a-z0-9]','','g')=regexp_replace(lower($2),'[^a-z0-9]','','g')",
    [w, value.question],
  );
  if (duplicates.some((d) => d.input.split !== value.split))
    throw new AppError(
      'SPLIT_CONFLICT',
      'Equivalent questions must remain in the same development/holdout split',
      409,
    );
  const row = await tx.must('INSERT INTO eval_cases(workspace_id,input) VALUES($1,$2) RETURNING *', [
    w,
    json(value),
  ]);
  await tx.exec(
    'INSERT INTO eval_case_revisions(workspace_id,case_id,revision,input,actor_id) VALUES($1,$2,1,$3,$4)',
    [w, row.id, json(value), actor],
  );
  return { ...value, id: row.id, revision: row.revision, frozen: row.frozen, createdAt: row.createdAt };
}
export async function createRun(tx: Tx, w: string, releaseId: string, ids?: string[]) {
  await tx.must('SELECT id FROM releases WHERE workspace_id=$1 AND id=$2', [w, releaseId]);
  const cases = await tx.rows(
    'SELECT * FROM eval_cases WHERE workspace_id=$1 AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) ORDER BY id LIMIT 500',
    [w, ids ?? null],
  );
  if (!cases.length)
    throw new AppError('NO_CHECKS', 'Create or import evaluation cases before running checks');
  if (ids && new Set(ids).size !== cases.length)
    throw new AppError('NOT_FOUND', 'One or more evaluation cases were not found', 404);
  const accepted = await enqueue(tx, w, 'evaluate', { releaseId }, null, 1);
  const run = await tx.must(
    'INSERT INTO eval_runs(workspace_id,release_id,job_id,limitations) VALUES($1,$2,$3,$4) RETURNING id',
    [w, releaseId, accepted.jobId, json(GRADING_LIMITATIONS)],
  );
  for (const c of cases) {
    await tx.exec('INSERT INTO eval_results(workspace_id,run_id,case_id,case_snapshot) VALUES($1,$2,$3,$4)', [
      w,
      run.id,
      c.id,
      json(c.input),
    ]);
    if (c.input.split === 'holdout')
      await tx.exec('UPDATE eval_cases SET frozen=true WHERE workspace_id=$1 AND id=$2', [w, c.id]);
  }
  await tx.exec('UPDATE jobs SET payload=$3 WHERE workspace_id=$1 AND id=$2', [
    w,
    accepted.jobId,
    json({ runId: run.id, releaseId }),
  ]);
  return accepted;
}
export async function importCases(db: Database, job: JobContext) {
  let cases = job.payload.cases;
  if (job.payload.csv) {
    const rows = parse(job.payload.csv, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      max_record_size: 30000,
    }) as Record<string, string>[];
    cases = rows.map((r) => ({
      caseId: r.case_id || undefined,
      question: r.question,
      conversationContext: r.conversation_context || undefined,
      previousAnswer: r.previous_answer || undefined,
      expectedFacts: r.expected_facts ? JSON.parse(r.expected_facts) : [],
      sourceIds: r.source_reference ? r.source_reference.split('|') : [],
      category: r.category || undefined,
      importance: r.importance || 'normal',
      split: r.split || 'development',
      baselineTimestamp: r.baseline_timestamp || undefined,
      control: r.control === 'true',
    }));
  }
  if (!Array.isArray(cases) || !cases.length || cases.length > 500)
    throw new AppError('INVALID_IMPORT', 'Provide between 1 and 500 cases');
  return db.tenant(job.workspaceId, async (tx) => {
    await fence(tx, job);
    for (const c of cases) await createCase(tx, job.workspaceId, c, job.payload.actorId);
    return { imported: cases.length };
  });
}
export async function evaluate(db: Database, config: Config, ai: AIProvider, job: JobContext) {
  const w = job.workspaceId;
  const rows = await db.tenant(w, async (tx) => {
    await fence(tx, job);
    await tx.exec("UPDATE eval_runs SET state='running' WHERE workspace_id=$1 AND id=$2", [
      w,
      job.payload.runId,
    ]);
    return tx.rows('SELECT * FROM eval_results WHERE workspace_id=$1 AND run_id=$2 ORDER BY id', [
      w,
      job.payload.runId,
    ]);
  });
  let failed = false;
  for (const result of rows) {
    if (result.answer || result.error) continue;
    try {
      const conversation = await db.tenant(w, (tx) =>
        tx.must("INSERT INTO conversations(workspace_id,mode) VALUES($1,'evaluation') RETURNING id", [w]),
      );
      await answerJob(db, config, ai, job, {
        question: result.caseSnapshot.question,
        history: result.caseSnapshot.conversationContext ?? '',
        releaseId: job.payload.releaseId,
        operationKey: `${job.id}:case:${result.caseId}`,
        kind: 'check',
        conversationId: conversation.id,
        gradeFacts: result.caseSnapshot.expectedFacts,
        resultId: result.id,
      });
    } catch (error) {
      failed = true;
      await db.tenant(w, (tx) =>
        tx.exec('UPDATE eval_results SET error=$3 WHERE workspace_id=$1 AND id=$2', [
          w,
          result.id,
          publicError(error).message,
        ]),
      );
    }
  }
  await db.tenant(w, (tx) =>
    tx.exec('UPDATE eval_runs SET state=$3 WHERE workspace_id=$1 AND id=$2', [
      w,
      job.payload.runId,
      failed ? 'failed' : 'succeeded',
    ]),
  );
  return { runId: job.payload.runId };
}
