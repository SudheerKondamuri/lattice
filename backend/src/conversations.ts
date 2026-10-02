import type { Database, Tx, Row } from './db.js';
import type { EmailProvider } from './providers.js';
import type { Answer, Evidence, HandoffRequest } from '../../src/contracts/api.js';
import { AppError, publicError } from './errors.js';
import { enqueue, json } from './util.js';
import { redactAnswer } from './answers.js';
import { fence, type JobContext } from './ingestion.js';
export async function conversationDetail(tx: Tx, w: string, id: string, visitor = false, actorKey?: string) {
  const conversation = await tx.must('SELECT * FROM conversations WHERE workspace_id=$1 AND id=$2', [w, id]);
  const rows = await tx.rows(
    'SELECT * FROM messages WHERE workspace_id=$1 AND conversation_id=$2 ORDER BY created_at,id LIMIT 1000',
    [w, id],
  );
  const messages: Row[] = [];
  for (const row of rows) {
    if (row.role === 'assistant' && row.releaseId) {
      const answer = await redactAnswer(
        tx,
        w,
        { ...row, messageId: row.id, conversationId: id } as Answer,
        !visitor && conversation.mode !== 'visitor',
      );
      messages.push({
        ...row,
        content: answer.content,
        evidence: answer.evidence,
        disposition: answer.disposition,
      });
    } else messages.push(row);
  }
  const escalations = await tx.rows(
    `SELECT id,conversation_id,status,email,attempts,last_error,sent_at,created_at FROM escalations e WHERE workspace_id=$1 AND conversation_id=$2 AND (NOT $3 OR EXISTS(SELECT 1 FROM jobs j WHERE j.workspace_id=e.workspace_id AND j.session_id=$4 AND j.payload->>'escalationId'=e.id::text)) ORDER BY created_at`,
    [w, id, visitor, actorKey ?? null],
  );
  const feedback = await tx.rows(
    `SELECT f.id,f.message_id,f.rating,f.comment,f.created_at FROM feedback f JOIN messages m ON m.workspace_id=f.workspace_id AND m.id=f.message_id WHERE f.workspace_id=$1 AND m.conversation_id=$2 AND (NOT $3 OR f.actor_key=$4) ORDER BY f.created_at,f.id`,
    [w, id, visitor, actorKey ?? null],
  );
  return { conversation, messages, escalations, feedback };
}
export async function createHandoff(
  tx: Tx,
  w: string,
  conversationId: string,
  input: HandoffRequest,
  sessionId: string | null,
) {
  await tx.must('SELECT id FROM conversations WHERE workspace_id=$1 AND id=$2', [w, conversationId]);
  const row = await tx.must(
    'INSERT INTO escalations(workspace_id,conversation_id,email,name,message) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [w, conversationId, input.email, input.name ?? '', input.message ?? ''],
  );
  return {
    ...(await enqueue(tx, w, 'email', { escalationId: row.id }, sessionId)),
    escalationId: row.id,
    status: 'pending' as const,
  };
}
export async function sendEscalation(db: Database, email: EmailProvider, job: JobContext) {
  const w = job.workspaceId,
    id = job.payload.escalationId;
  const escalation = await db.tenant(w, async (tx) => {
    await fence(tx, job);
    const row = await tx.must('SELECT * FROM escalations WHERE workspace_id=$1 AND id=$2', [w, id]);
    if (row.status === 'sent') return row;
    if (row.firstAttemptAt && Date.now() - new Date(row.firstAttemptAt).getTime() > 23 * 3600000)
      throw new AppError(
        'DELIVERY_RECONCILIATION_REQUIRED',
        'Provider deduplication window expired; reconcile delivery with the provider before any further send',
        409,
      );
    let payload = row.deliveryPayload;
    if (!payload) {
      const agent = await tx.must(
        'SELECT coalesce(r.config,a.draft_config) config FROM agents a LEFT JOIN releases r ON r.workspace_id=a.workspace_id AND r.id=a.published_release_id WHERE a.workspace_id=$1',
        [w],
      );
      const detail = await conversationDetail(tx, w, row.conversationId, true);
      payload = {
        to: agent.config.supportEmail,
        replyTo: row.email,
        subject: `Support handoff ${id}`,
        text: `Contact: ${row.name} <${row.email}>\nRequest: ${row.message}\n\n${detail.messages
          .map(
            (m) =>
              `${m.role}: ${m.content}\nSources: ${(m.evidence as Evidence[]).map((e) => `${e.sourceId}@${e.sourceVersionId}`).join(', ')}`,
          )
          .join('\n\n')
          .slice(-60000)}`,
      };
    }
    await tx.exec(
      "UPDATE escalations SET delivery_payload=$3,first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1,status='pending' WHERE workspace_id=$1 AND id=$2",
      [w, id, json(payload)],
    );
    return { ...row, deliveryPayload: payload };
  });
  if (escalation.status === 'sent')
    return {
      id,
      conversationId: escalation.conversationId,
      status: 'sent',
      email: escalation.email,
      attempts: escalation.attempts,
      lastError: escalation.lastError,
      sentAt: escalation.sentAt,
      createdAt: escalation.createdAt,
    };
  try {
    const providerId = await email.send(`lattice-escalation-${id}`, escalation.deliveryPayload);
    return db.tenant(w, async (tx) => {
      await fence(tx, job);
      return tx.must(
        "UPDATE escalations SET status='sent',provider_id=$3,sent_at=now(),last_error=null WHERE workspace_id=$1 AND id=$2 RETURNING id,conversation_id,status,email,attempts,last_error,sent_at,created_at",
        [w, id, providerId],
      );
    });
  } catch (error) {
    await db.tenant(w, (tx) =>
      tx.exec(
        "UPDATE escalations SET status='failed',last_error=$3 WHERE workspace_id=$1 AND id=$2 AND status<>'sent'",
        [w, id, publicError(error).message],
      ),
    );
    throw error;
  }
}
export async function addFeedback(
  tx: Tx,
  w: string,
  conversationId: string,
  actor: string,
  input: { messageId: string; rating: string; comment?: string },
) {
  await tx.must(
    "SELECT id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3 AND role='assistant'",
    [w, conversationId, input.messageId],
  );
  return tx.must(
    'INSERT INTO feedback(workspace_id,message_id,actor_key,rating,comment) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,message_id,actor_key) DO UPDATE SET rating=excluded.rating,comment=excluded.comment RETURNING id',
    [w, input.messageId, actor, input.rating, input.comment ?? null],
  );
}
export async function deleteConversation(tx: Tx, w: string, id: string) {
  await tx.must('SELECT id FROM conversations WHERE workspace_id=$1 AND id=$2', [w, id]);
  const escalations = await tx.rows(
    'SELECT id FROM escalations WHERE workspace_id=$1 AND conversation_id=$2',
    [w, id],
  );
  await tx.exec(
    "UPDATE jobs SET state='failed',payload='{}',result=null,error=$4,finished_at=now() WHERE workspace_id=$1 AND (payload->>'conversationId'=$2 OR result->>'conversationId'=$2 OR payload->>'escalationId'=ANY($3::text[]))",
    [
      w,
      id,
      escalations.map((e) => e.id),
      json({ code: 'CONVERSATION_DELETED', message: 'Transcript erased' }),
    ],
  );
  await tx.exec('DELETE FROM conversations WHERE workspace_id=$1 AND id=$2', [w, id]);
  return { deleted: true };
}
