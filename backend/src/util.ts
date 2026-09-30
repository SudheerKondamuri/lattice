import { createHash } from 'node:crypto';
import type { Tx } from './db.js';
import { AppError } from './errors.js';
export const hash = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
export const json = (value: unknown) => JSON.stringify(value);
export async function idempotent<T>(
  tx: Tx,
  workspace: string,
  actor: string,
  key: string,
  input: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  if (!/^[\x21-\x7e]{8,128}$/.test(key))
    throw new AppError('IDEMPOTENCY_REQUIRED', 'Idempotency-Key must contain 8–128 printable characters');
  const fingerprint = hash(json(input));
  const prior = await tx.one('SELECT * FROM idempotency WHERE workspace_id=$1 AND actor_key=$2 AND key=$3', [
    workspace,
    actor,
    key,
  ]);
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Key already used with different input', 409);
    return prior.response as T;
  }
  const response = await operation();
  await tx.exec(
    'INSERT INTO idempotency(workspace_id,actor_key,key,fingerprint,response) VALUES($1,$2,$3,$4,$5)',
    [workspace, actor, key, fingerprint, json(response)],
  );
  return response;
}
export async function rateLimit(tx: Tx, key: string, limit: number, seconds = 60) {
  const row = await tx.must(
    `INSERT INTO rate_limits(key,window_start,count) VALUES($1,now(),1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start < now()-$2*interval '1 second' THEN 1 ELSE rate_limits.count+1 END,
    window_start=CASE WHEN rate_limits.window_start < now()-$2*interval '1 second' THEN now() ELSE rate_limits.window_start END RETURNING count`,
    [key, seconds],
  );
  if (row.count > limit) throw new AppError('RATE_LIMIT', 'Too many requests; please try again shortly', 429);
}
export async function enqueue(
  tx: Tx,
  workspace: string,
  kind: string,
  payload: unknown,
  sessionId: string | null = null,
  maxAttempts = 3,
) {
  if (kind === 'ingest' && payload && typeof payload === 'object' && 'sourceId' in payload) {
    const row = await tx.must(
      'UPDATE sources SET ingestion_revision=ingestion_revision+1 WHERE workspace_id=$1 AND id=$2 RETURNING ingestion_revision',
      [workspace, (payload as { sourceId: string }).sourceId],
    );
    payload = { ...payload, ingestionRevision: row.ingestionRevision };
  }
  const row = await tx.must(
    'INSERT INTO jobs(workspace_id,kind,payload,session_id,max_attempts) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [workspace, kind, json(payload), sessionId, maxAttempts],
  );
  return { jobId: row.id as string };
}
export function page<T extends Record<string, any>>(items: T[], limit: number) {
  return { items: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1].id : null };
}
