import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { harness, testDatabase } from './helpers.js';
import type { Database } from '../src/db.js';
import { DEFAULT_RAG_POLICY, ragPolicy } from '../src/pipeline.js';
let db: Database;
beforeAll(async () => {
  db = await testDatabase();
});
afterAll(async () => {
  await db.close();
});
it('requires optimistic source revisions and rejects a competing owner edit', async () => {
  const h = await harness(db);
  try {
    const created = await h.request('POST', `/workspaces/${h.w}/sources`, {
      title: 'Original',
      kind: 'text',
      content: 'Refunds take 30 days.',
    });
    const id = created.json().data.sourceId;
    const source = (await h.request('GET', `/workspaces/${h.w}/sources/${id}`)).json().data.source;
    expect(source.revision).toBeGreaterThan(0);
    const first = await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, {
      title: 'First edit',
      expectedRevision: source.revision,
    });
    expect(first.statusCode, first.body).toBe(200);
    const stale = await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, {
      title: 'Lost edit',
      expectedRevision: source.revision,
    });
    expect(stale.statusCode).toBe(409);
    const missing = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${h.w}/sources/${id}`,
      headers: { authorization: `Bearer ${h.owner}`, 'idempotency-key': randomUUID() },
      payload: { title: 'Unsafe overwrite' },
    });
    expect(missing.statusCode).toBe(400);
    expect((await h.request('GET', `/workspaces/${h.w}/sources/${id}`)).json().data.source.title).toBe(
      'First edit',
    );
  } finally {
    await h.app.close();
  }
});
it('settings revisions cover behavior, retention and spending without clobbering source changes', async () => {
  const h = await harness(db);
  try {
    const initial = (await h.request('GET', `/workspaces/${h.w}/settings`)).json().data;
    expect(initial.revision).toBeGreaterThan(0);
    const result = await h.request('PATCH', `/workspaces/${h.w}/settings`, {
      expectedRevision: initial.revision,
      retentionDays: 7,
      config: {
        tone: 'Concise',
        ragPolicy: {
          topK: 4,
          minSimilarity: 0.6,
          chunkSizeChars: 2000,
          chunkOverlapChars: 200,
          maxHistoryChars: 4000,
        },
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().data.retentionDays).toBe(7);
    expect(result.json().data.agent.draftConfig.ragPolicy.topK).toBe(4);
    const conflict = await h.request('PATCH', `/workspaces/${h.w}/settings`, {
      expectedRevision: initial.revision,
      monthlySpendLimitMicros: 1,
    });
    expect(conflict.statusCode).toBe(409);
  } finally {
    await h.app.close();
  }
});
it('sanitizes malformed persisted retrieval policy values instead of sending NaN to the database', () => {
  expect(
    ragPolicy({
      topK: Number.NaN,
      minSimilarity: Number.NaN,
      chunkSizeChars: Number.POSITIVE_INFINITY,
      chunkOverlapChars: Number.NaN,
      maxHistoryChars: Number.NaN,
    }),
  ).toEqual(DEFAULT_RAG_POLICY);
});
