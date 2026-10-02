import type { Tx } from './db.js';
import { AppError } from './errors.js';
import { json } from './util.js';
export async function releaseDetail(tx: Tx, w: string, id: string) {
  return tx.must(
    `SELECT r.*,coalesce((SELECT jsonb_agg(source_version_id) FROM release_sources WHERE workspace_id=r.workspace_id AND release_id=r.id),'[]') source_version_ids,(SELECT min(created_at) FROM publications WHERE workspace_id=r.workspace_id AND release_id=r.id) published_at FROM releases r WHERE workspace_id=$1 AND id=$2`,
    [w, id],
  );
}
export async function snapshot(tx: Tx, w: string, label: string) {
  const agent = await tx.must('SELECT * FROM agents WHERE workspace_id=$1', [w]);
  const release = await tx.must(
    'INSERT INTO releases(workspace_id,label,config,draft_revision) VALUES($1,$2,$3,$4) RETURNING id',
    [w, label, json(agent.draftConfig), agent.draftRevision],
  );
  await tx.exec(
    `INSERT INTO release_sources(workspace_id,release_id,source_id,source_version_id,title,authority,approval_required)
    SELECT workspace_id,$2,id,draft_version_id,title,authority,approval_required FROM sources WHERE workspace_id=$1 AND status='active' AND draft_version_id IS NOT NULL`,
    [w, release.id],
  );
  await tx.exec(
    'INSERT INTO release_dependencies(workspace_id,release_id,source_id,dependency_id) SELECT workspace_id,$2,source_id,dependency_id FROM source_dependencies WHERE workspace_id=$1',
    [w, release.id],
  );
  return releaseDetail(tx, w, release.id);
}
export async function releaseChecks(tx: Tx, w: string, id: string) {
  await releaseDetail(tx, w, id);
  const run = await tx.one(
    'SELECT * FROM eval_runs WHERE workspace_id=$1 AND release_id=$2 ORDER BY created_at DESC LIMIT 1',
    [w, id],
  );
  const rows = run
    ? await tx.rows('SELECT * FROM eval_results WHERE workspace_id=$1 AND run_id=$2', [w, run.id])
    : [];
  const failures = rows.filter(
    (r) =>
      r.error ||
      r.deterministic.missingFacts?.length ||
      r.deterministic.eligibleCitations === false ||
      r.preliminaryGrade?.supported === false,
  ).length;
  const regressions = rows.filter((r) => r.humanVerdict === 'baseline_better').length;
  const unreviewed = rows.filter((r) => !r.humanVerdict || r.humanVerdict === 'ungradable').length;
  const criticalUnreviewed = rows.filter(
    (r) => r.caseSnapshot.importance === 'critical' && (!r.humanVerdict || r.humanVerdict === 'ungradable'),
  ).length;
  const warnings: string[] = [];
  if (!run) warnings.push('No checks have been run for this release');
  else if (run.state !== 'succeeded') warnings.push(`Latest check run is ${run.state}`);
  if (failures) warnings.push(`${failures} checks have deterministic/preliminary failures`);
  if (regressions) warnings.push(`${regressions} human-reviewed regressions`);
  if (unreviewed) warnings.push(`${unreviewed} checks are unreviewed or ungradable`);
  const changed = await tx.must(
    `SELECT count(*)::int total FROM eval_cases c WHERE workspace_id=$1 AND NOT EXISTS(SELECT 1 FROM eval_results r WHERE r.workspace_id=c.workspace_id AND r.run_id=$2 AND r.case_id=c.id AND r.case_snapshot=c.input)`,
    [w, run?.id ?? null],
  );
  if (changed.total)
    warnings.push(`${changed.total} current checks are absent or changed since the latest run`);
  const sources = await tx.rows(
    `SELECT s.title,s.status,s.held,s.processing_state,s.warnings,rs.source_version_id,s.draft_version_id FROM release_sources rs JOIN sources s ON s.workspace_id=rs.workspace_id AND s.id=rs.source_id WHERE rs.workspace_id=$1 AND rs.release_id=$2`,
    [w, id],
  );
  for (const s of sources) {
    if (s.status !== 'active') warnings.push(`${s.title}: ${s.status}; ineligible across releases`);
    if (s.held && s.sourceVersionId !== s.draftVersionId)
      warnings.push(`${s.title}: suspect older version remains withheld`);
    if (s.processingState !== 'ready' || s.warnings.length)
      warnings.push(`${s.title}: extraction requires review`);
  }
  return {
    releaseId: id,
    latestRunId: run?.id ?? null,
    failures,
    regressions,
    unreviewed,
    criticalUnreviewed,
    warnings,
  };
}
export async function publish(
  tx: Tx,
  w: string,
  id: string,
  expected: string | null,
  acknowledge: boolean,
  actor: string | null,
  mode: 'publish' | 'rollback' | 'automatic' = 'publish',
) {
  const agent = await tx.must('SELECT * FROM agents WHERE workspace_id=$1 FOR UPDATE', [w]);
  if (agent.publishedReleaseId !== expected)
    throw new AppError('PUBLISH_CONFLICT', 'Published release changed; refresh before publishing', 409);
  const release = await releaseDetail(tx, w, id);
  if (mode === 'rollback' && !release.publishedAt)
    throw new AppError('INVALID_ROLLBACK', 'Only previously published releases can be restored', 409);
  const checks = await releaseChecks(tx, w, id);
  const blockingWarnings =
    mode === 'automatic' && checks.criticalUnreviewed === 0
      ? checks.warnings.filter(
          (warning) => warning !== `${checks.unreviewed} checks are unreviewed or ungradable`,
        )
      : checks.warnings;
  if (blockingWarnings.length && !acknowledge)
    throw new AppError(
      'REVIEW_REQUIRED',
      'Review checks and explicitly acknowledge warnings before publication',
      409,
      checks,
    );
  if (mode === 'automatic') {
    if (release.draftRevision !== agent.draftRevision)
      throw new AppError('REVIEW_REQUIRED', 'Draft changed after automatic check snapshot', 409);
    if (!agent.publishedReleaseId || !agent.draftConfig.autoPublish || blockingWarnings.length)
      throw new AppError('REVIEW_REQUIRED', 'Automatic publication is paused pending review', 409);
    const approval = await tx.one(
      `SELECT 1 FROM release_sources rs JOIN sources s ON s.workspace_id=rs.workspace_id AND s.id=rs.source_id WHERE rs.workspace_id=$1 AND rs.release_id=$2 AND (s.held OR (s.approval_required AND NOT EXISTS(SELECT 1 FROM release_sources previous WHERE previous.workspace_id=rs.workspace_id AND previous.release_id=$3 AND previous.source_id=rs.source_id AND previous.source_version_id=rs.source_version_id)))`,
      [w, id, agent.publishedReleaseId],
    );
    if (approval)
      throw new AppError('REVIEW_REQUIRED', 'Approval-required sources need explicit owner publication', 409);
  }
  await tx.exec(
    'INSERT INTO publications(workspace_id,release_id,previous_release_id,actor_id,mode,checks) VALUES($1,$2,$3,$4,$5,$6)',
    [w, id, expected, actor, mode, json(checks)],
  );
  await tx.exec('UPDATE agents SET published_release_id=$2 WHERE workspace_id=$1', [w, id]);
  // Only an explicit publication of the current replacement clears a hold. Rollback never does.
  if (mode === 'publish')
    await tx.exec(
      `UPDATE sources s SET held=false WHERE workspace_id=$1 AND status='active' AND EXISTS(SELECT 1 FROM release_sources rs WHERE rs.workspace_id=s.workspace_id AND rs.source_id=s.id AND rs.release_id=$2 AND rs.source_version_id=s.draft_version_id)`,
      [w, id],
    );
  return tx.must('SELECT * FROM agents WHERE workspace_id=$1', [w]);
}
