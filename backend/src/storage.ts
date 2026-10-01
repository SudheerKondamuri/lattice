import { z } from 'zod';
import type { Config } from './config.js';
import type { Database, Row } from './db.js';
import { AppError, configured } from './errors.js';
import { fence, type JobContext } from './ingestion.js';
export interface AssetStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export function supabaseStorage(config: Config): AssetStorage {
  let validatedAt = 0;
  const bucket = config.SUPABASE_STORAGE_BUCKET;
  const base = `${config.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1`;
  function headers() {
    const key = configured(config.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY for private Storage');
    return { Authorization: `Bearer ${key}`, apikey: key };
  }
  function objectKey(key: string) {
    if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/original$/.test(key))
      throw new AppError('INVALID_STORAGE_KEY', 'Invalid private object identifier');
    return key.split('/').map(encodeURIComponent).join('/');
  }
  async function verifyPrivate() {
    if (Date.now() - validatedAt < 60000) return;
    const response = await fetch(`${base}/bucket/${encodeURIComponent(bucket)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new AppError(
        'CONFIGURATION_ERROR',
        'Private Supabase Storage bucket is unavailable; configure the bucket and server credential',
        503,
      );
    const data = z.object({ public: z.boolean() }).parse(await response.json());
    if (data.public)
      throw new AppError('CONFIGURATION_ERROR', 'Source originals require a private Storage bucket', 503);
    validatedAt = Date.now();
  }
  async function request(path: string, init: RequestInit) {
    await verifyPrivate();
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers(), ...init.headers },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new AppError(
        'STORAGE_PROVIDER_ERROR',
        `Private storage operation failed (HTTP ${response.status})`,
        503,
      );
    return response;
  }
  return {
    async put(key, bytes, contentType) {
      if (bytes.length > config.MAX_UPLOAD_BYTES)
        throw new AppError('UPLOAD_TOO_LARGE', 'Asset exceeds upload limit', 413);
      await request(`/object/${bucket}/${objectKey(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
        body: new Uint8Array(bytes),
      });
    },
    async get(key) {
      const response = await request(`/object/authenticated/${bucket}/${objectKey(key)}`, { method: 'GET' });
      if (!response.body) throw new AppError('STORAGE_PROVIDER_ERROR', 'Empty asset response', 503);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > config.MAX_UPLOAD_BYTES)
            throw new AppError('STORAGE_PROVIDER_ERROR', 'Asset exceeds configured download limit', 503);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks);
    },
    async remove(key) {
      await request(`/object/${bucket}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [objectKey(key)] }),
      });
    },
  };
}
export async function assetBytes(
  db: Database,
  storage: AssetStorage,
  job: JobContext,
  asset: Row,
): Promise<Buffer> {
  if (asset.storageState === 'stored') return storage.get(asset.objectKey);
  if (asset.storageState !== 'pending' || !asset.bytes)
    throw new AppError('ASSET_MISSING', 'Original asset is unavailable', 422);
  const bytes = Buffer.from(asset.bytes);
  await storage.put(asset.objectKey, bytes, asset.mediaType);
  await db.tenant(job.workspaceId, async (tx) => {
    await fence(tx, job);
    await tx.must("SELECT id FROM sources WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'", [
      job.workspaceId,
      asset.sourceId,
    ]);
    await tx.exec(
      "UPDATE assets SET bytes=null,storage_state='stored' WHERE workspace_id=$1 AND id=$2 AND storage_state='pending'",
      [job.workspaceId, asset.id],
    );
  });
  return bytes;
}
export async function deleteAsset(db: Database, storage: AssetStorage, job: JobContext) {
  const asset = await db.tenant(job.workspaceId, (tx) =>
    tx.must('SELECT * FROM assets WHERE workspace_id=$1 AND id=$2', [job.workspaceId, job.payload.assetId]),
  );
  if (asset.storageState === 'deleted') return { deleted: true };
  await storage.remove(asset.objectKey);
  await db.tenant(job.workspaceId, async (tx) => {
    await fence(tx, job);
    await tx.exec(
      "UPDATE assets SET storage_state='deleted',bytes=null,size_bytes=0 WHERE workspace_id=$1 AND id=$2",
      [job.workspaceId, asset.id],
    );
  });
  return { deleted: true };
}
