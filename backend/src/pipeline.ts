import type { RagPolicy } from '../../src/contracts/api.js';
import type { Database } from './db.js';
import { json } from './util.js';
import { fence, type JobContext } from './ingestion.js';
export const DEFAULT_RAG_POLICY: RagPolicy = {
  topK: 6,
  minSimilarity: 0.45,
  chunkSizeChars: 2400,
  chunkOverlapChars: 400,
  maxHistoryChars: 6000,
};
export function ragPolicy(value?: Partial<RagPolicy>): RagPolicy {
  const candidate = { ...DEFAULT_RAG_POLICY, ...value };
  const finite = (input: unknown, fallback: number) =>
    typeof input === 'number' && Number.isFinite(input) ? input : fallback;
  const chunkSizeChars = Math.max(
    500,
    Math.min(2400, Math.floor(finite(candidate.chunkSizeChars, DEFAULT_RAG_POLICY.chunkSizeChars))),
  );
  return {
    topK: Math.max(1, Math.min(8, Math.floor(finite(candidate.topK, DEFAULT_RAG_POLICY.topK)))),
    minSimilarity: Math.max(
      0,
      Math.min(1, finite(candidate.minSimilarity, DEFAULT_RAG_POLICY.minSimilarity)),
    ),
    chunkSizeChars,
    chunkOverlapChars: Math.max(
      0,
      Math.min(
        chunkSizeChars - 1,
        Math.floor(finite(candidate.chunkOverlapChars, DEFAULT_RAG_POLICY.chunkOverlapChars)),
      ),
    ),
    maxHistoryChars: Math.max(
      0,
      Math.min(6000, Math.floor(finite(candidate.maxHistoryChars, DEFAULT_RAG_POLICY.maxHistoryChars))),
    ),
  };
}
export async function step<T>(
  db: Database,
  job: JobContext,
  stage: string,
  operation: () => Promise<T>,
  details: (value: T) => unknown = () => ({}),
): Promise<T> {
  await db.tenant(job.workspaceId, async (tx) => {
    await fence(tx, job);
    await tx.exec(
      `INSERT INTO job_steps(workspace_id,job_id,stage,state) VALUES($1,$2,$3,'running') ON CONFLICT(workspace_id,job_id,stage) DO UPDATE SET state='running',finished_at=null`,
      [job.workspaceId, job.id, stage],
    );
  });
  try {
    const result = await operation();
    await db.tenant(job.workspaceId, async (tx) => {
      await fence(tx, job);
      await tx.exec(
        "UPDATE job_steps SET state='succeeded',details=$4,finished_at=now() WHERE workspace_id=$1 AND job_id=$2 AND stage=$3",
        [job.workspaceId, job.id, stage, json(details(result))],
      );
    });
    return result;
  } catch (error) {
    await db.tenant(job.workspaceId, (tx) =>
      tx.exec(
        "UPDATE job_steps SET state='failed',finished_at=now() WHERE workspace_id=$1 AND job_id=$2 AND stage=$3 AND EXISTS(SELECT 1 FROM jobs WHERE workspace_id=$1 AND id=$2 AND lease_token=$4)",
        [job.workspaceId, job.id, stage, job.leaseToken],
      ),
    );
    throw error;
  }
}
