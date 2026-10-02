import type { Database, Tx, Row } from './db.js';
import type { Config } from './config.js';
import type { AIProvider, Generated } from './providers.js';
import { PROMPT_VERSION, AI_INPUT_TOKEN_BOUND } from './providers.js';
import type { AgentConfig, Answer, Evidence } from '../../src/contracts/api.js';
import { AppError } from './errors.js';
import { json } from './util.js';
import { reserve, settle } from './usage.js';
import { fence, type JobContext } from './ingestion.js';
import { ragPolicy } from './pipeline.js';
export function selectAuthority<T extends { authority: string; score: number }>(items: T[]): T[] {
  if (!items.length) return [];
  const priorities: Record<string, number> = { approved: 3, authoritative: 2, reference: 1 };
  const highest = Math.max(...items.map((item) => priorities[item.authority] ?? 0));
  return items
    .filter((item) => priorities[item.authority] === highest)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}
export async function eligibleEvidence(
  tx: Tx,
  w: string,
  evidence: Evidence[],
  draft = false,
  releaseId?: string,
): Promise<Evidence[]> {
  const output: Evidence[] = [];
  for (const e of evidence) {
    const eligible = releaseId
      ? await tx.must('SELECT release_eligible($1,$2,$3,$4) eligible', [w, e.sourceId, releaseId, draft])
      : await tx.must('SELECT source_eligible($1,$2,$3) eligible', [w, e.sourceId, draft]);
    output.push({
      ...e,
      eligible: eligible.eligible,
      excerpt: eligible.eligible ? e.excerpt : '[Source revoked]',
    });
  }
  return output;
}
export async function retrieve(
  tx: Tx,
  w: string,
  releaseId: string,
  question: string,
  vector: number[],
  draft: boolean,
  policy = ragPolicy(),
): Promise<Evidence[]> {
  const rows = await tx.rows(
    `WITH candidates AS (
    SELECT c.id,c.source_id,c.source_version_id,c.content,c.reference,rs.title,rs.authority,
      ts_rank_cd(c.search,websearch_to_tsquery('english',$3)) lexical,(1-(c.embedding <=> $4::vector)) similarity
    FROM chunks c JOIN release_sources rs ON rs.workspace_id=c.workspace_id AND rs.source_version_id=c.source_version_id AND rs.source_id=c.source_id
    WHERE c.workspace_id=$1 AND rs.release_id=$2 AND release_eligible(c.workspace_id,c.source_id,rs.release_id,$5)
  ), ranked AS (SELECT *,1.0/(60+row_number() OVER(ORDER BY lexical DESC))+1.0/(60+row_number() OVER(ORDER BY similarity DESC)) score FROM candidates WHERE lexical>0 OR similarity>$6)
  SELECT * FROM ranked ORDER BY score DESC LIMIT $7`,
    [w, releaseId, question, json(vector), draft, policy.minSimilarity, policy.topK * 5],
  );
  return selectAuthority<Row & { authority: string; score: number }>(
    rows.map((r) => ({ ...r, authority: r.authority, score: Number(r.score) })),
  ).map((r) => ({
    sourceId: r.sourceId,
    sourceVersionId: r.sourceVersionId,
    chunkId: r.id,
    title: r.title,
    authority: r.authority as Evidence['authority'],
    excerpt: r.content,
    ...r.reference,
    eligible: true,
  }));
}
export function fallback(config: AgentConfig) {
  return `${config.handoffMessage} Contact ${config.supportEmail}.`;
}
export async function redactAnswer(tx: Tx, w: string, answer: Answer, draft = false): Promise<Answer> {
  const evidence = await eligibleEvidence(tx, w, answer.evidence, draft, answer.releaseId);
  if (evidence.some((e) => !e.eligible)) {
    const release = await tx.must('SELECT config FROM releases WHERE workspace_id=$1 AND id=$2', [
      w,
      answer.releaseId,
    ]);
    return { ...answer, content: fallback(release.config), disposition: 'handoff', evidence };
  }
  return { ...answer, evidence };
}
export async function answerJob(
  db: Database,
  config: Config,
  ai: AIProvider,
  job: JobContext,
  options?: {
    question: string;
    history: string;
    releaseId: string;
    operationKey: string;
    kind: 'check';
    conversationId: string;
    gradeFacts: string[];
    resultId: string;
  },
) {
  const w = job.workspaceId;
  const started = Date.now();
  const payload = options ?? job.payload;
  const key = options?.operationKey ?? `${job.id}:answer`;
  const kind = options ? 'check' : job.payload.mode === 'visitor' ? 'reply' : 'preview';
  const generationBound = Math.ceil(
    (AI_INPUT_TOKEN_BOUND * config.AI_INPUT_MICROS_PER_MILLION +
      800 * config.AI_OUTPUT_MICROS_PER_MILLION +
      8000 * config.EMBEDDING_MICROS_PER_MILLION) /
      1_000_000,
  );
  const gradingBound = Math.ceil(
    (AI_INPUT_TOKEN_BOUND * config.GRADING_INPUT_MICROS_PER_MILLION +
      500 * config.GRADING_OUTPUT_MICROS_PER_MILLION) /
      1_000_000,
  );
  const reserveMicros = Math.max(
    options ? config.CHECK_RESERVE_MICROS : config.ANSWER_RESERVE_MICROS,
    generationBound + (options ? gradingBound : 0),
  );
  const context = await db.tenant(w, async (tx) => {
    await fence(tx, job);
    const release = await tx.must('SELECT * FROM releases WHERE workspace_id=$1 AND id=$2', [
      w,
      payload.releaseId,
    ]);
    await tx.must('SELECT id FROM conversations WHERE workspace_id=$1 AND id=$2', [
      w,
      payload.conversationId,
    ]);
    const prior = await tx.one(
      'SELECT result FROM jobs WHERE workspace_id=$1 AND id=$2 AND result IS NOT NULL',
      [w, job.id],
    );
    if (prior && !options) return { prior: prior.result as Answer, release, history: '' };
    const rows = await tx.rows(
      'SELECT role,content,evidence,release_id FROM messages WHERE workspace_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 8',
      [w, payload.conversationId],
    );
    const safe = [];
    for (const row of rows) {
      const evidence = await eligibleEvidence(tx, w, row.evidence, kind !== 'reply', row.releaseId);
      if (!evidence.some((e) => !e.eligible)) safe.push(`${row.role}: ${row.content}`);
    }
    await reserve(tx, w, key, kind, reserveMicros, config);
    return { prior: null, release, history: options?.history ?? safe.reverse().join('\n').slice(-6000) };
  });
  if (context.prior) return { answer: context.prior, grade: null };
  let cost = 0;
  try {
    const [vector] = await ai.embed([payload.question]);
    cost += Math.ceil(
      (Buffer.byteLength(payload.question) * config.EMBEDDING_MICROS_PER_MILLION) / 1_000_000,
    );
    const policy = ragPolicy((context.release.config as AgentConfig).ragPolicy);
    const evidence = await db.tenant(w, (tx) =>
      retrieve(tx, w, payload.releaseId, payload.question, vector, kind !== 'reply', policy),
    );
    const agent = context.release.config as AgentConfig;
    let generated: Generated = {
      content: fallback(agent),
      disposition: 'handoff',
      citationIds: [],
      inputTokens: 0,
      outputTokens: 0,
      model: '',
    };
    let aiAuthored = evidence.length > 0;
    if (evidence.length)
      generated = await ai.answer(
        payload.question,
        context.history.slice(-policy.maxHistoryChars),
        evidence.slice(0, policy.topK),
        agent,
      );
    const ids = new Set(generated.citationIds);
    const cited = evidence.filter((e) => ids.has(e.chunkId));
    if (generated.disposition === 'answer' && (!cited.length || ids.size !== cited.length)) {
      generated = { ...generated, content: fallback(agent), disposition: 'handoff', citationIds: [] };
      aiAuthored = false;
    }
    // Citation links are created by the UI from IDs. Never propagate model-controlled asset URLs.
    generated.content = generated.content
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '[link omitted]');
    cost += Math.ceil(
      (generated.inputTokens * config.AI_INPUT_MICROS_PER_MILLION +
        generated.outputTokens * config.AI_OUTPUT_MICROS_PER_MILLION) /
        1_000_000,
    );
    const grade =
      options && evidence.length
        ? await ai.grade(payload.question, generated.content, options.gradeFacts, cited)
        : null;
    if (grade && typeof grade === 'object' && 'inputTokens' in grade && 'outputTokens' in grade)
      cost += Math.ceil(
        (Number(grade.inputTokens) * config.GRADING_INPUT_MICROS_PER_MILLION +
          Number(grade.outputTokens) * config.GRADING_OUTPUT_MICROS_PER_MILLION) /
          1_000_000,
      );
    const answer = await db.tenant(w, async (tx) => {
      await fence(tx, job);
      await tx.must('SELECT id FROM conversations WHERE workspace_id=$1 AND id=$2', [
        w,
        payload.conversationId,
      ]);
      const checked = await eligibleEvidence(tx, w, evidence, kind !== 'reply', payload.releaseId);
      const revoked = checked.some((e) => !e.eligible);
      if (revoked)
        generated = { ...generated, content: fallback(agent), disposition: 'handoff', citationIds: [] };
      const deliveredEvidence = revoked ? [] : checked;
      const message = await tx.must(
        `INSERT INTO messages(workspace_id,conversation_id,role,content,release_id,disposition,evidence,model,prompt_version,input_tokens,output_tokens,latency_ms) VALUES($1,$2,'assistant',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,created_at`,
        [
          w,
          payload.conversationId,
          generated.content,
          payload.releaseId,
          generated.disposition,
          json(deliveredEvidence),
          generated.model || null,
          PROMPT_VERSION,
          generated.inputTokens,
          generated.outputTokens,
          Date.now() - started,
        ],
      );
      const result: Answer = {
        conversationId: payload.conversationId,
        messageId: message.id,
        releaseId: payload.releaseId,
        content: generated.content,
        disposition: generated.disposition,
        evidence: deliveredEvidence,
        model: generated.model || null,
        promptVersion: PROMPT_VERSION,
        createdAt: message.createdAt,
      };
      await settle(tx, w, key, kind === 'check' || (aiAuthored && !revoked), cost);
      if (!options)
        await tx.exec(
          "UPDATE jobs SET result=$3,state='succeeded',finished_at=now(),lease_until=null WHERE workspace_id=$1 AND id=$2",
          [w, job.id, json(result)],
        );
      else
        await tx.exec(
          'UPDATE eval_results SET answer=$3,deterministic=$4,preliminary_grade=$5 WHERE workspace_id=$1 AND id=$2',
          [
            w,
            options.resultId,
            json(result),
            json({
              missingFacts: options.gradeFacts.filter(
                (fact) => !result.content.toLowerCase().includes(fact.toLowerCase()),
              ),
              eligibleCitations:
                result.disposition !== 'answer' ||
                (result.evidence.length > 0 && result.evidence.every((e) => e.eligible)),
            }),
            json(grade),
          ],
        );
      await tx.exec('UPDATE conversations SET updated_at=now() WHERE workspace_id=$1 AND id=$2', [
        w,
        payload.conversationId,
      ]);
      return result;
    });
    return { answer, grade };
  } catch (error) {
    await db.tenant(w, (tx) =>
      settle(
        tx,
        w,
        key,
        false,
        error instanceof AppError && ['CONFIGURATION_ERROR', 'CONTEXT_LIMIT'].includes(error.code)
          ? cost
          : Math.max(cost, reserveMicros),
      ),
    );
    throw error;
  }
}
