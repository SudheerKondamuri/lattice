import type { Tx } from './db.js';
import type { CreateSource, UpdateSource } from '../../src/contracts/api.js';
import { AppError } from './errors.js';
import { enqueue, json } from './util.js';
import { validateUrl } from './network.js';
import { randomUUID } from 'node:crypto';
export async function sourceDetail(tx: Tx, w: string, id: string) {
  const source = await tx.must(
    `SELECT s.*,(SELECT rs.source_version_id FROM release_sources rs JOIN agents a ON a.workspace_id=rs.workspace_id AND a.published_release_id=rs.release_id WHERE rs.workspace_id=s.workspace_id AND rs.source_id=s.id) published_version_id FROM sources s WHERE workspace_id=$1 AND id=$2`,
    [w, id],
  );
  const versions = await tx.rows(
    'SELECT id,source_id,content_hash,content,page_count,warnings,refs AS references,created_at FROM source_versions WHERE workspace_id=$1 AND source_id=$2 ORDER BY created_at DESC LIMIT 30',
    [w, id],
  );
  return { source, versions };
}
export async function setDependencies(tx: Tx, w: string, id: string, dependencies: string[]) {
  for (const dependency of dependencies) {
    await tx.must("SELECT id FROM sources WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'", [
      w,
      dependency,
    ]);
    if (dependency === id) throw new AppError('DEPENDENCY_CYCLE', 'Source cannot depend on itself');
    const cycle = await tx.one(
      `WITH RECURSIVE deps AS (SELECT dependency_id id FROM source_dependencies WHERE workspace_id=$1 AND source_id=$2 UNION SELECT d.dependency_id FROM source_dependencies d JOIN deps ON d.source_id=deps.id WHERE d.workspace_id=$1) SELECT id FROM deps WHERE id=$3`,
      [w, dependency, id],
    );
    if (cycle) throw new AppError('DEPENDENCY_CYCLE', 'Cyclic source dependency');
  }
  await tx.exec('DELETE FROM source_dependencies WHERE workspace_id=$1 AND source_id=$2', [w, id]);
  for (const dep of new Set(dependencies))
    await tx.exec('INSERT INTO source_dependencies(workspace_id,source_id,dependency_id) VALUES($1,$2,$3)', [
      w,
      id,
      dep,
    ]);
}
export async function assertStorage(tx: Tx, w: string, additional: number, limit: number) {
  const row = await tx.must(
    `SELECT coalesce((SELECT sum(size_bytes) FROM assets WHERE workspace_id=$1 AND storage_state<>'deleted'),0)+coalesce((SELECT sum(octet_length(content)) FROM source_versions WHERE workspace_id=$1),0)+coalesce((SELECT sum(octet_length(content)+6144) FROM chunks WHERE workspace_id=$1),0)+coalesce((SELECT sum(octet_length(payload::text)) FROM jobs WHERE workspace_id=$1 AND state IN ('queued','running')),0) total`,
    [w],
  );
  if (Number(row.total) + additional > limit)
    throw new AppError(
      'STORAGE_LIMIT',
      'Workspace knowledge storage limit reached; delete unused sources before importing more',
      429,
    );
}
export async function createSource(
  tx: Tx,
  w: string,
  input: CreateSource,
  asset?: { bytes: Buffer; filename: string; mediaType: string },
  storageLimit = 100 * 1024 * 1024,
) {
  if (['website', 'sitemap'].includes(input.kind)) {
    if (!input.url) throw new AppError('VALIDATION_ERROR', 'Website URL is required');
    validateUrl(input.url);
  } else if (!asset && !input.content)
    throw new AppError('VALIDATION_ERROR', 'Text content or an uploaded file is required');
  if (['pdf', 'qa_xlsx'].includes(input.kind) && !asset)
    throw new AppError('VALIDATION_ERROR', 'This format requires a file upload');
  await assertStorage(tx, w, asset?.bytes.length ?? Buffer.byteLength(input.content ?? ''), storageLimit);
  const count = await tx.must(
    "SELECT count(*)::int total FROM sources WHERE workspace_id=$1 AND status<>'deleted'",
    [w],
  );
  if (count.total >= 1000) throw new AppError('SOURCE_LIMIT', 'Maximum source count reached', 429);
  const source = await tx.must(
    'INSERT INTO sources(workspace_id,title,kind,url,authority,approval_required) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
    [
      w,
      input.title,
      input.kind,
      input.url ?? null,
      input.authority ?? 'reference',
      input.approvalRequired ?? false,
    ],
  );
  await setDependencies(tx, w, source.id, input.dependsOnSourceIds ?? []);
  if (input.crawlPolicy)
    await tx.exec('UPDATE sources SET crawl_policy=$3 WHERE workspace_id=$1 AND id=$2', [
      w,
      source.id,
      json(input.crawlPolicy),
    ]);
  let assetId: string | null = null;
  if (asset) {
    const id = randomUUID();
    assetId = (
      await tx.must(
        'INSERT INTO assets(workspace_id,source_id,bytes,media_type,filename,id,object_key,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [
          w,
          source.id,
          asset.bytes,
          asset.mediaType,
          asset.filename,
          id,
          `${w}/${source.id}/${id}/original`,
          asset.bytes.length,
        ],
      )
    ).id;
  }
  await tx.exec('UPDATE agents SET draft_revision=draft_revision+1 WHERE workspace_id=$1', [w]);
  return {
    sourceId: source.id,
    ...(await enqueue(tx, w, 'ingest', { sourceId: source.id, content: input.content ?? null, assetId })),
  };
}
export async function updateSource(
  tx: Tx,
  w: string,
  id: string,
  input: UpdateSource,
  storageLimit = 100 * 1024 * 1024,
) {
  const source = await tx.must(
    "SELECT * FROM sources WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'",
    [w, id],
  );
  if (input.expectedRevision !== source.revision)
    throw new AppError('SOURCE_CONFLICT', 'Source changed; refresh before saving', 409);
  if (input.content) await assertStorage(tx, w, Buffer.byteLength(input.content), storageLimit);
  if (input.content && ['website', 'sitemap', 'pdf', 'qa_xlsx'].includes(source.kind))
    throw new AppError(
      'VALIDATION_ERROR',
      'Use a text or approved-answer source to correct extracted document content',
    );
  await tx.exec(
    `UPDATE sources SET title=coalesce($3,title),authority=coalesce($4,authority),approval_required=coalesce($5,approval_required),status=coalesce($6,status),crawl_policy=coalesce($7,crawl_policy) WHERE workspace_id=$1 AND id=$2 AND revision=$8`,
    [
      w,
      id,
      input.title ?? null,
      input.authority ?? null,
      input.approvalRequired ?? null,
      input.action === 'archive' ? 'archived' : input.action === 'restore' ? 'active' : null,
      input.crawlPolicy ? json(input.crawlPolicy) : null,
      source.revision,
    ],
  );
  if (input.dependsOnSourceIds) await setDependencies(tx, w, id, input.dependsOnSourceIds);
  await tx.exec('UPDATE agents SET draft_revision=draft_revision+1 WHERE workspace_id=$1', [w]);
  if (input.content) {
    await tx.exec("UPDATE sources SET processing_state='queued' WHERE workspace_id=$1 AND id=$2", [w, id]);
    return { ...(await enqueue(tx, w, 'ingest', { sourceId: id, content: input.content })), sourceId: id };
  }
  return (await sourceDetail(tx, w, id)).source;
}
export async function deleteSource(tx: Tx, w: string, id: string) {
  await tx.must('SELECT id FROM sources WHERE workspace_id=$1 AND id=$2', [w, id]);
  await tx.exec(
    "UPDATE sources SET status='deleted',held=true,draft_version_id=null WHERE workspace_id=$1 AND id=$2",
    [w, id],
  );
  await tx.exec('DELETE FROM chunks WHERE workspace_id=$1 AND source_id=$2', [w, id]);
  // Keep identifiers/hashes for provenance; purge original and extracted material.
  await tx.exec(
    "UPDATE source_versions SET content='',asset_id=null,refs='[]' WHERE workspace_id=$1 AND source_id=$2",
    [w, id],
  );
  const assets = await tx.rows(
    "UPDATE assets SET bytes=null,storage_state='deleting' WHERE workspace_id=$1 AND source_id=$2 AND storage_state<>'deleted' RETURNING id",
    [w, id],
  );
  for (const asset of assets) await enqueue(tx, w, 'storage_delete', { assetId: asset.id }, null, 10);
  await tx.exec(
    "INSERT INTO revocations(workspace_id,resource_id,kind) VALUES($1,$2,'source') ON CONFLICT DO NOTHING",
    [w, id],
  );
  await tx.exec(
    "UPDATE jobs SET payload=payload-'content',state='failed',error=$3,finished_at=now() WHERE workspace_id=$1 AND payload->>'sourceId'=$2 AND state IN ('queued','running')",
    [w, id, json({ code: 'SOURCE_DELETED', message: 'Source was permanently deleted' })],
  );
  await tx.exec(
    "UPDATE jobs SET result=null,payload=payload-'content' WHERE workspace_id=$1 AND kind='ingest' AND payload->>'sourceId'=$2",
    [w, id],
  );
  await tx.exec('UPDATE agents SET draft_revision=draft_revision+1 WHERE workspace_id=$1', [w]);
  return { deleted: true };
}
