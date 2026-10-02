import { randomUUID } from 'node:crypto';
import type { Database } from './db.js';
import type { Config } from './config.js';
import type { AIProvider, EmailProvider } from './providers.js';
import { AppError, publicError } from './errors.js';
import { ingest, type JobContext } from './ingestion.js';
import { answerJob } from './answers.js';
import { evaluate, importCases } from './evaluations.js';
import { sendEscalation } from './conversations.js';
import { maintain, maintenanceReview } from './maintenance.js';
import { json } from './util.js';
import { settle } from './usage.js';
import { deleteAsset, supabaseStorage, type AssetStorage } from './storage.js';
export interface WorkerDeps {
  db: Database;
  config: Config;
  ai: AIProvider;
  email: EmailProvider;
  storage?: AssetStorage;
}
export async function claimJob(db: Database) {
  return db.system(async (tx) => {
    // Dead workers are made visible. Uncertain AI calls are not automatically repeated.
    const abandoned = await tx.rows(
      "UPDATE jobs SET state='failed',finished_at=now(),error=$1 WHERE state='running' AND lease_until<now() AND attempts>=max_attempts RETURNING workspace_id,kind,payload",
      [json({ code: 'WORKER_LOST', message: 'Worker lease expired; inspect the operation before retrying' })],
    );
    for (const lost of abandoned) {
      if (lost.kind === 'ingest')
        await tx.exec(
          "UPDATE sources SET processing_state='failed',warnings='[\"Worker lease expired; reprocess required\"]' WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'",
          [lost.workspaceId, lost.payload.sourceId],
        );
      if (lost.kind === 'evaluate')
        await tx.exec("UPDATE eval_runs SET state='failed' WHERE workspace_id=$1 AND id=$2", [
          lost.workspaceId,
          lost.payload.runId,
        ]);
      if (lost.kind === 'email')
        await tx.exec(
          "UPDATE escalations SET status='failed',last_error='Worker lease expired; inspect provider delivery receipt' WHERE workspace_id=$1 AND id=$2 AND status<>'sent'",
          [lost.workspaceId, lost.payload.escalationId],
        );
    }
    const row = await tx.one(
      `SELECT * FROM jobs WHERE ((state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now())) AND attempts<max_attempts ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!row) return null;
    const leaseToken = randomUUID();
    await tx.exec(
      "UPDATE jobs SET state='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '60 seconds' WHERE id=$1",
      [row.id, leaseToken],
    );
    return { ...row, attempts: row.attempts + 1, leaseToken } as JobContext & {
      kind: string;
      attempts: number;
      maxAttempts: number;
    };
  });
}
export async function runOne(deps: WorkerDeps): Promise<boolean> {
  const job = await claimJob(deps.db);
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void deps.db
      .system((tx) =>
        tx.exec(
          "UPDATE jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$2 AND state='running'",
          [job.id, job.leaseToken],
        ),
      )
      .catch(() => {});
  }, 15000);
  heartbeat.unref();
  try {
    let result: unknown;
    switch (job.kind) {
      case 'ingest':
        result = await ingest(
          deps.db,
          deps.config,
          deps.ai,
          job,
          deps.storage ?? supabaseStorage(deps.config),
        );
        break;
      case 'answer':
        result = (await answerJob(deps.db, deps.config, deps.ai, job)).answer;
        break;
      case 'eval_import':
        result = await importCases(deps.db, job);
        break;
      case 'evaluate':
        result = await evaluate(deps.db, deps.config, deps.ai, job);
        break;
      case 'email':
        result = await sendEscalation(deps.db, deps.email, job);
        break;
      case 'maintenance':
        result = await maintain(deps.db, job);
        break;
      case 'maintenance_review':
        result = await maintenanceReview(deps.db, job);
        break;
      case 'storage_delete':
        result = await deleteAsset(deps.db, deps.storage ?? supabaseStorage(deps.config), job);
        break;
      default:
        throw new AppError('UNKNOWN_JOB', 'Unsupported background operation');
    }
    const storedResult = job.kind === 'ingest' ? { sourceId: job.payload.sourceId } : result;
    await deps.db.tenant(job.workspaceId, (tx) =>
      tx.exec(
        "UPDATE jobs SET state='succeeded',result=$4,error=null,finished_at=now(),lease_until=null,payload=payload-'content'-'csv'-'cases' WHERE workspace_id=$1 AND id=$2 AND lease_token=$3 AND state='running'",
        [job.workspaceId, job.id, job.leaseToken, json(storedResult)],
      ),
    );
  } catch (error) {
    await deps.db.tenant(job.workspaceId, async (tx) => {
      const retryable =
        error instanceof AppError &&
        [
          'WAITING_FOR_DEPENDENCIES',
          'FETCH_FAILED',
          'EMAIL_PROVIDER_ERROR',
          'STORAGE_PROVIDER_ERROR',
        ].includes(error.code);
      const retry = retryable && job.attempts < job.maxAttempts;
      await tx.exec(
        "UPDATE jobs SET state=$4,error=$5,finished_at=CASE WHEN $4='failed' THEN now() ELSE NULL END,available_at=now()+$6*interval '1 second',lease_until=null WHERE workspace_id=$1 AND id=$2 AND lease_token=$3 AND state='running'",
        [
          job.workspaceId,
          job.id,
          job.leaseToken,
          retry ? 'queued' : 'failed',
          json(publicError(error)),
          Math.min(60, 5 * 2 ** Math.min(job.attempts, 4)),
        ],
      );
      if (job.kind === 'ingest' && !retry)
        await tx.exec(
          "UPDATE sources SET processing_state='failed',warnings=$3 WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'",
          [job.workspaceId, job.payload.sourceId, json([publicError(error).message])],
        );
      if (job.kind === 'evaluate' && !retry)
        await tx.exec("UPDATE eval_runs SET state='failed' WHERE workspace_id=$1 AND id=$2", [
          job.workspaceId,
          job.payload.runId,
        ]);
      if (job.kind === 'email' && !retry)
        await tx.exec(
          "UPDATE escalations SET status='failed',last_error=$3 WHERE workspace_id=$1 AND id=$2 AND status<>'sent'",
          [job.workspaceId, job.payload.escalationId, publicError(error).message],
        );
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
export async function recoverSpend(db: Database) {
  const stale = await db.system((tx) =>
    tx.rows(
      "SELECT DISTINCT workspace_id FROM usage_events WHERE state='reserved' AND created_at<now()-interval '15 minutes'",
    ),
  );
  for (const row of stale)
    await db.tenant(row.workspaceId, async (tx) => {
      const reservations = await tx.rows(
        "SELECT * FROM usage_events u WHERE workspace_id=$1 AND state='reserved' AND created_at<now()-interval '15 minutes' AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.workspace_id=u.workspace_id AND j.id::text=split_part(u.operation_key,':',1) AND j.state='running' AND j.lease_until>now())",
        [row.workspaceId],
      );
      for (const r of reservations)
        await settle(tx, row.workspaceId, r.operationKey, false, Number(r.reserveMicros));
    });
}
