import type { Database, Tx } from './db.js';
import type { Config } from './config.js';
import type { AIProvider } from './providers.js';
import { AppError } from './errors.js';
import { chunkSections, crawl, plainText, pythonParse, qaCsv, type Parsed } from './parsing.js';
import { hash, json } from './util.js';
import { budgeted, usage } from './usage.js';
import { assertStorage, sourceDetail } from './sources.js';
import { assetBytes, supabaseStorage, type AssetStorage } from './storage.js';
import { ragPolicy, step } from './pipeline.js';
export interface JobContext {
  workspaceId: string;
  id: string;
  leaseToken: string;
  payload: Record<string, any>;
}
export async function fence(tx: Tx, job: JobContext) {
  const row = await tx.one(
    "SELECT id FROM jobs WHERE workspace_id=$1 AND id=$2 AND lease_token=$3 AND state='running' AND lease_until>now() FOR UPDATE",
    [job.workspaceId, job.id, job.leaseToken],
  );
  if (!row) throw new AppError('JOB_LEASE_LOST', 'Job lease expired or operation was cancelled', 409);
}
export async function ingest(
  db: Database,
  config: Config,
  ai: AIProvider,
  job: JobContext,
  storage: AssetStorage = supabaseStorage(config),
) {
  const w = job.workspaceId,
    id = job.payload.sourceId;
  const state = await db.tenant(w, async (tx) => {
    await fence(tx, job);
    const source = await tx.must(
      "SELECT * FROM sources WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'",
      [w, id],
    );
    const asset = job.payload.assetId
      ? await tx.must('SELECT * FROM assets WHERE workspace_id=$1 AND source_id=$2 AND id=$3', [
          w,
          id,
          job.payload.assetId,
        ])
      : await tx.one(
          'SELECT * FROM assets WHERE workspace_id=$1 AND source_id=$2 ORDER BY created_at DESC LIMIT 1',
          [w, id],
        );
    await tx.exec("UPDATE sources SET processing_state='processing' WHERE workspace_id=$1 AND id=$2", [
      w,
      id,
    ]);
    const previous = source.draftVersionId
      ? await tx.one('SELECT * FROM source_versions WHERE workspace_id=$1 AND id=$2', [
          w,
          source.draftVersionId,
        ])
      : null;
    if (job.payload.ingestionRevision !== source.ingestionRevision)
      throw new AppError('SUPERSEDED', 'Newer import superseded this job', 409);
    const agent = await tx.must('SELECT draft_config FROM agents WHERE workspace_id=$1', [w]);
    return { source, asset, previous, policy: ragPolicy(agent.draftConfig.ragPolicy) };
  });
  const bytes = state.asset
    ? await step(db, job, 'store_original', () => assetBytes(db, storage, job, state.asset!))
    : null;
  let parsed: Parsed;
  if (['website', 'sitemap'].includes(state.source.kind))
    parsed = await step(
      db,
      job,
      'crawl',
      () => crawl(state.source.url, state.source.kind, config, undefined, state.source.crawlPolicy),
      (value) => ({ pages: value.pageCount, warnings: value.warnings }),
    );
  else if (['pdf', 'qa_xlsx'].includes(state.source.kind)) {
    if (!state.asset) throw new AppError('ASSET_MISSING', 'Original upload is missing', 422);
    // Reserve the maximum possible OCR allocation before the subprocess starts.
    if (state.source.kind === 'pdf')
      parsed = await budgeted(
        db,
        config,
        w,
        `${job.id}:ocr`,
        'ocr',
        config.OCR_RESERVE_MICROS * config.MAX_OCR_PAGES,
        () =>
          pythonParse('pdf', bytes!, config).then((value) => ({
            value,
            cost: value.ocrPages * config.OCR_RESERVE_MICROS,
            units: value.ocrPages,
          })),
        config.MAX_OCR_PAGES,
      );
    else parsed = await pythonParse('qa_xlsx', bytes!, config);
  } else {
    const content =
      job.payload.content ??
      (state.previous && !state.previous.assetId
        ? state.previous.content
        : state.asset
          ? bytes!.toString('utf8')
          : state.previous?.content);
    if (typeof content !== 'string')
      throw new AppError('CONTENT_MISSING', 'Source has no reprocessable content', 422);
    parsed = state.source.kind === 'qa_csv' ? qaCsv(content) : plainText(content);
  }
  const content = parsed.sections.map((s) => s.text).join('\n\n');
  const contentHash = hash(json(parsed.sections));
  if (state.previous?.contentHash === contentHash) {
    return db.tenant(w, async (tx) => {
      await fence(tx, job);
      await tx.exec(
        "UPDATE sources SET last_checked_at=now(),processing_state=CASE WHEN jsonb_array_length(warnings)>0 THEN 'partial' ELSE 'ready' END WHERE workspace_id=$1 AND id=$2",
        [w, id],
      );
      return sourceDetail(tx, w, id);
    });
  }
  if (state.source.approvalRequired && state.previous)
    await db.tenant(w, async (tx) => {
      await fence(tx, job);
      await tx.exec('UPDATE sources SET held=true WHERE workspace_id=$1 AND id=$2', [w, id]);
    });
  const chunks = chunkSections(parsed, state.policy);
  await step(
    db,
    job,
    'extract',
    async () => parsed,
    (value) => ({ pages: value.pageCount, warnings: value.warnings, ocrPages: value.ocrPages }),
  );
  await step(
    db,
    job,
    'chunk',
    async () => chunks,
    (value) => ({ chunks: value.length, policy: state.policy }),
  );
  const prior = await db.tenant(w, (tx) =>
    tx.rows(
      'SELECT content,reference,embedding::text embedding FROM chunks WHERE workspace_id=$1 AND source_version_id=$2',
      [w, state.source.draftVersionId],
    ),
  );
  const cache = new Map(
    prior.map((row) => [hash(json([row.content, row.reference])), JSON.parse(row.embedding) as number[]]),
  );
  const vectors: (number[] | undefined)[] = chunks.map((c) =>
    cache.get(hash(json([c.content, c.reference]))),
  );
  const missing = chunks.flatMap((_, i) => (vectors[i] ? [] : [i]));
  for (let start = 0; start < missing.length;) {
    const indices: number[] = [];
    let batchBytes = 0;
    while (start + indices.length < missing.length && indices.length < 64) {
      const index = missing[start + indices.length];
      const bytes = Buffer.byteLength(chunks[index].content);
      if (indices.length && batchBytes + bytes > 128000) break;
      indices.push(index);
      batchBytes += bytes;
    }
    const texts = indices.map((i) => chunks[i].content);
    const estimated = Math.ceil((batchBytes * config.EMBEDDING_MICROS_PER_MILLION) / 1_000_000);
    const embeddings = await step(
      db,
      job,
      `embed_${start}`,
      () =>
        budgeted(
          db,
          config,
          w,
          `${job.id}:embed:${start}`,
          'embedding',
          Math.max(config.EMBEDDING_RESERVE_MICROS, estimated),
          async () => ({ value: await ai.embed(texts), cost: estimated }),
        ),
      (value) => ({ chunks: value.length }),
    );
    indices.forEach((index, i) => (vectors[index] = embeddings[i]));
    start += indices.length;
  }
  return db.tenant(w, async (tx) => {
    await fence(tx, job);
    await tx.must("SELECT id FROM sources WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'", [w, id]);
    const currentSource = await tx.must(
      'SELECT ingestion_revision FROM sources WHERE workspace_id=$1 AND id=$2',
      [w, id],
    );
    if (currentSource.ingestionRevision !== job.payload.ingestionRevision)
      throw new AppError('SUPERSEDED', 'Newer import superseded this job', 409);
    const current = await usage(tx, w);
    await assertStorage(
      tx,
      w,
      Buffer.byteLength(content) +
        chunks.reduce((total, c) => total + Buffer.byteLength(c.content) + 6144, 0),
      config.MAX_WORKSPACE_STORAGE_BYTES,
    );
    const pages = await tx.must(
      "SELECT coalesce(sum(v.page_count),0)::int pages FROM sources s JOIN source_versions v ON v.workspace_id=s.workspace_id AND v.id=s.draft_version_id WHERE s.workspace_id=$1 AND s.id<>$2 AND s.status<>'deleted'",
      [w, id],
    );
    if (pages.pages + parsed.pageCount > current.limits.sourcePages)
      throw new AppError(
        'SOURCE_PAGE_LIMIT',
        'Import exceeds source-page allowance; previous published knowledge remains unchanged',
        429,
      );
    const version = await tx
      .must(
        `INSERT INTO source_versions(workspace_id,source_id,content_hash,content,page_count,warnings,refs,asset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,source_id,content_hash) DO NOTHING RETURNING id,true is_new`,
        [
          w,
          id,
          contentHash,
          content,
          parsed.pageCount,
          json(parsed.warnings),
          json(parsed.sections.map(({ text: _, ...ref }) => ref)),
          job.payload.content ? null : (state.asset?.id ?? null),
        ],
      )
      .catch(async (error) => {
        const existing = await tx.one(
          'SELECT id,false is_new FROM source_versions WHERE workspace_id=$1 AND source_id=$2 AND content_hash=$3',
          [w, id, contentHash],
        );
        if (existing) return existing;
        throw error;
      });
    if (version.isNew)
      for (let i = 0; i < chunks.length; i++)
        await tx.exec(
          'INSERT INTO chunks(workspace_id,source_id,source_version_id,ordinal,content,reference,embedding) VALUES($1,$2,$3,$4,$5,$6,$7::vector)',
          [w, id, version.id, i, chunks[i].content, json(chunks[i].reference), json(vectors[i])],
        );
    await tx.exec(
      'UPDATE sources SET draft_version_id=$3,processing_state=$4,warnings=$5,last_checked_at=now() WHERE workspace_id=$1 AND id=$2',
      [w, id, version.id, parsed.warnings.length ? 'partial' : 'ready', json(parsed.warnings)],
    );
    await tx.exec('UPDATE agents SET draft_revision=draft_revision+1 WHERE workspace_id=$1', [w]);
    await tx.exec(
      "INSERT INTO job_steps(workspace_id,job_id,stage,state,details,finished_at) VALUES($1,$2,'stage','succeeded',$3,now()) ON CONFLICT DO NOTHING",
      [w, job.id, json({ versionId: version.id, pages: parsed.pageCount })],
    );
    return sourceDetail(tx, w, id);
  });
}
