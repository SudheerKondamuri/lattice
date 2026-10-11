import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Database } from '../src/db.js';
import { harness, mockAI, mockEmail, mockStorage, testConfig, testDatabase } from './helpers.js';
import { runOne, recoverSpend, claimJob, type WorkerDeps } from '../src/jobs.js';
import { answerJob } from '../src/answers.js';
import { fence } from '../src/ingestion.js';
import { openAI } from '../src/providers.js';
import { reserve, settle, usage } from '../src/usage.js';
import { applyStripeEvent, stripeClient } from '../src/billing.js';
import { createApp } from '../src/app.js';
import { publish } from '../src/releases.js';
import { enqueue, json } from '../src/util.js';
import { scheduleDaily } from '../src/maintenance.js';
import { AppError } from '../src/errors.js';

let db: Database;
let h: Awaited<ReturnType<typeof harness>>;
let deps: WorkerDeps;
beforeAll(async () => {
  db = await testDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  h = await harness(db);
  deps = { db, config: testConfig, ai: mockAI(), email: mockEmail, storage: mockStorage };
});
afterEach(async () => {
  await h.app.close();
  vi.unstubAllGlobals();
});
async function drain() {
  for (let i = 0; i < 100; i++) {
    if (!(await runOne(deps))) return;
  }
  throw new Error('Queue did not drain');
}
async function source(content = 'The refund window is 30 days.', authority = 'authoritative') {
  const response = await h.request('POST', `/workspaces/${h.w}/sources`, {
    title: 'Policy',
    kind: 'text',
    content,
    authority,
  });
  expect(response.statusCode, response.body).toBe(202);
  await drain();
  const job = await h.request('GET', `/workspaces/${h.w}/jobs/${response.json().data.jobId}`);
  expect(job.json().data.state, job.body).toBe('succeeded');
  return response.json().data.sourceId as string;
}
async function release() {
  const result = await h.request('POST', `/workspaces/${h.w}/releases`, { label: 'Candidate' });
  expect(result.statusCode, result.body).toBe(201);
  return result.json().data;
}
async function publishRelease(id: string, expected: string | null = null) {
  const res = await h.request('POST', `/workspaces/${h.w}/releases/${id}/publish`, {
    expectedPublishedReleaseId: expected,
    acknowledgeWarnings: true,
  });
  expect(res.statusCode, res.body).toBe(200);
}
async function visitor() {
  const result = await h.request('POST', '/public/sessions', { agentId: h.agent.id }, h.owner, {
    origin: 'https://customer.example',
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json().data;
}
async function ask(session: any, question = 'What is the refund window?') {
  const result = await h.request('POST', '/public/messages', { question }, session.token, {
    origin: 'https://customer.example',
  });
  expect(result.statusCode, result.body).toBe(202);
  return result.json().data.jobId;
}

describe('Tenant, role, contracts and durable ingestion', () => {
  it('reserves invitation slots, accepts the verified email, and protects the owner membership', async () => {
    const invite = () =>
      h.request('POST', `/workspaces/${h.w}/members`, { email: `${h.outsider}@example.com`, role: 'member' });
    expect((await invite()).statusCode).toBe(429);
    expect((await h.request('DELETE', `/workspaces/${h.w}/members/${h.owner}`)).statusCode).toBe(409);
    expect((await h.request('DELETE', `/workspaces/${h.w}/members/${h.member}`)).statusCode).toBe(200);
    expect((await invite()).statusCode).toBe(201);
    const bootstrap = await h.request('GET', '/bootstrap', undefined, h.outsider);
    expect(bootstrap.json().data.workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: h.w, role: 'member' })]),
    );
    expect((await h.request('GET', `/workspaces/${h.w}/settings`, undefined, h.outsider)).statusCode).toBe(
      200,
    );
    expect(
      (await h.request('PATCH', `/workspaces/${h.w}/settings`, { retentionDays: 7 }, h.outsider)).statusCode,
    ).toBe(403);
  });
  it('rejects cross-tenant access, member mutations, and RLS reads without the tenant', async () => {
    const id = await source();
    expect(
      (await h.request('GET', `/workspaces/${h.w}/sources/${id}`, undefined, h.outsider)).statusCode,
    ).toBe(404);
    expect(
      (await h.request('DELETE', `/workspaces/${h.w}/sources/${id}`, undefined, h.member)).statusCode,
    ).toBe(403);
    expect((await h.request('GET', `/workspaces/${h.w}/sources/${id}`, undefined, h.member)).statusCode).toBe(
      200,
    );
    const other = await harness(db);
    expect(
      await db.tenant(other.w, (tx) => tx.rows('SELECT id FROM sources WHERE workspace_id=$1', [h.w])),
    ).toEqual([]);
    expect((await other.request('GET', `/workspaces/${other.w}/sources/${id}`)).statusCode).toBe(404);
    await other.app.close();
  });
  it('makes creation retries idempotent and rejects changed input', async () => {
    const key = randomUUID(),
      body = { title: 'A', kind: 'text', content: 'Documented answer' };
    const first = await h.request('POST', `/workspaces/${h.w}/sources`, body, h.owner, {
      'idempotency-key': key,
    });
    const retry = await h.request('POST', `/workspaces/${h.w}/sources`, body, h.owner, {
      'idempotency-key': key,
    });
    expect(retry.json().data).toEqual(first.json().data);
    expect(
      (
        await h.request('POST', `/workspaces/${h.w}/sources`, { ...body, content: 'Changed' }, h.owner, {
          'idempotency-key': key,
        })
      ).statusCode,
    ).toBe(409);
    await drain();
  });
  it('persists empty extraction failures without replacing a published source', async () => {
    const id = await source();
    const r = await release();
    await publishRelease(r.id);
    const edit = await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, { content: '   ' });
    expect(edit.statusCode).toBe(202);
    await drain();
    const job = await h.request('GET', `/workspaces/${h.w}/jobs/${edit.json().data.jobId}`);
    expect(job.json().data.state).toBe('failed');
    const detail = (await h.request('GET', `/workspaces/${h.w}/sources/${id}`)).json().data;
    expect(detail.source.processingState).toBe('failed');
    expect(detail.source.publishedVersionId).toBe(r.sourceVersionIds[0]);
  });
  it('rejects a private-network website import and exposes a terminal failure', async () => {
    const response = await h.request('POST', `/workspaces/${h.w}/sources`, {
      title: 'Unsafe',
      kind: 'website',
      url: 'http://127.0.0.1',
    });
    await drain();
    const job = (await h.request('GET', `/workspaces/${h.w}/jobs/${response.json().data.jobId}`)).json().data;
    expect(job.state).toBe('failed');
    expect(job.error.code).toBe('CRAWL_FAILED');
  });
  it('keeps uploaded originals private, checks visitor citation access, and revokes downloads', async () => {
    const boundary = 'lattice-fixture-boundary';
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nPolicy file\r\n--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\ntext\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="policy.txt"\r\nContent-Type: text/plain\r\n\r\nRefunds take 30 days.\r\n--${boundary}--\r\n`,
    );
    const upload = await h.request('POST', `/workspaces/${h.w}/sources/upload`, body, h.owner, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
    expect(upload.statusCode, upload.body).toBe(202);
    await drain();
    const id = upload.json().data.sourceId;
    expect((await h.request('GET', `/workspaces/${h.w}/sources/${id}/asset`)).body).toBe(
      'Refunds take 30 days.',
    );
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    const asset = () =>
      h.request('GET', `/public/sources/${id}/asset`, undefined, session.token, {
        origin: 'https://customer.example',
      });
    expect((await asset()).statusCode).toBe(404);
    await ask(session);
    await drain();
    expect((await asset()).body).toBe('Refunds take 30 days.');
    await h.request('DELETE', `/workspaces/${h.w}/sources/${id}`);
    expect((await asset()).statusCode).toBe(404);
    const transcript = (
      await h.request('GET', '/public/conversation', undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data;
    expect(transcript.messages[1].content).not.toContain('30 days');
  });
});
describe('Versioned answers, evidence and correction', () => {
  it('exposes feedback for owner correction without disclosing staff comments to a visitor', async () => {
    await source();
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    const jobId = await ask(session);
    await drain();
    const answer = (
      await h.request('GET', `/public/jobs/${jobId}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data.result;
    expect(
      (
        await h.request(
          'POST',
          '/public/feedback',
          { messageId: answer.messageId, rating: 'unhelpful', comment: 'Missing detail' },
          session.token,
          { origin: 'https://customer.example' },
        )
      ).statusCode,
    ).toBe(200);
    await h.request('POST', `/workspaces/${h.w}/conversations/${session.conversationId}/feedback`, {
      messageId: answer.messageId,
      rating: 'unhelpful',
      comment: 'Private staff assessment',
    });
    const owner = (
      await h.request('GET', `/workspaces/${h.w}/conversations/${session.conversationId}`)
    ).json().data;
    expect(owner.feedback).toHaveLength(2);
    const publicView = (
      await h.request('GET', '/public/conversation', undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data;
    expect(publicView.feedback).toEqual([expect.objectContaining({ comment: 'Missing detail' })]);
    expect(
      (await h.request('GET', `/workspaces/${h.w}/conversations`)).json().data.items[0].unhelpfulCount,
    ).toBe(2);
  });
  it('supports archive/restore and exact version reversion without extending immutable chunks', async () => {
    const id = await source();
    const original = (await h.request('GET', `/workspaces/${h.w}/sources/${id}`)).json().data.source
      .draftVersionId;
    const r = await release();
    await publishRelease(r.id);
    expect(
      (await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, { action: 'archive' })).statusCode,
    ).toBe(200);
    expect(
      (await db.tenant(h.w, (tx) => tx.must('SELECT source_eligible($1,$2,false) eligible', [h.w, id])))
        .eligible,
    ).toBe(false);
    expect(
      (await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, { action: 'restore' })).statusCode,
    ).toBe(200);
    expect(
      (await db.tenant(h.w, (tx) => tx.must('SELECT source_eligible($1,$2,false) eligible', [h.w, id])))
        .eligible,
    ).toBe(true);
    await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, {
      content: 'Refunds are available for 60 days.',
    });
    await drain();
    await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, {
      content: 'The refund window is 30 days.',
    });
    await drain();
    expect(
      (await h.request('GET', `/workspaces/${h.w}/sources/${id}`)).json().data.source.draftVersionId,
    ).toBe(original);
    await expect(
      db.tenant(h.w, (tx) =>
        tx.exec(
          'INSERT INTO chunks(workspace_id,source_id,source_version_id,ordinal,content,reference,embedding) SELECT workspace_id,source_id,source_version_id,999,content,reference,embedding FROM chunks WHERE workspace_id=$1 AND source_version_id=$2 LIMIT 1',
          [h.w, original],
        ),
      ),
    ).rejects.toThrow('immutable');
    await expect(
      db.tenant(h.w, (tx) =>
        tx.exec("UPDATE source_versions SET content='changed' WHERE workspace_id=$1 AND id=$2", [
          h.w,
          original,
        ]),
      ),
    ).rejects.toThrow('immutable');
  });
  it('isolates staged edits from visitor answers and retains exact earlier evidence', async () => {
    const id = await source();
    const first = await release();
    await publishRelease(first.id);
    const session = await visitor();
    const jobId = await ask(session);
    await drain();
    const before = (
      await h.request('GET', `/public/jobs/${jobId}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data.result;
    expect(before.content).toContain('30 days');
    expect(before.releaseId).toBe(first.id);
    await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, {
      content: 'The refund window is 60 days.',
    });
    await drain();
    const preview = await h.request('POST', `/workspaces/${h.w}/preview`, {
      question: 'What is the refund window?',
    });
    await drain();
    const draft = (await h.request('GET', `/workspaces/${h.w}/jobs/${preview.json().data.jobId}`)).json().data
      .result;
    expect(draft.content).toContain('60 days');
    const nextJob = await ask(session);
    await drain();
    const published = (
      await h.request('GET', `/public/jobs/${nextJob}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data.result;
    expect(published.content).toContain('30 days');
    expect(published.evidence[0].sourceVersionId).toBe(before.evidence[0].sourceVersionId);
    expect(before.evidence[0].excerpt).toContain('30 days');
  });
  it('discards an answer when its evidence is deleted while the provider is pending', async () => {
    const id = await source();
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    const jobId = await ask(session);
    const base = deps.ai;
    deps.ai = {
      ...base,
      answer: async (...args) => {
        expect((await h.request('DELETE', `/workspaces/${h.w}/sources/${id}`)).statusCode).toBe(200);
        return base.answer(...args);
      },
    };
    await drain();
    const job = (
      await h.request('GET', `/public/jobs/${jobId}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data;
    expect(job.result.disposition).toBe('handoff');
    expect(job.result.content).not.toContain('30 days');
    expect(job.result.evidence).toEqual([]);
    expect((await h.request('GET', `/workspaces/${h.w}/usage`)).json().data.used.reply).toBe(0);
  });
  it('cannot resurrect deleted knowledge through rollback or asset access', async () => {
    const id = await source();
    const first = await release();
    await publishRelease(first.id);
    const second = await release();
    await publishRelease(second.id, first.id);
    await h.request('DELETE', `/workspaces/${h.w}/sources/${id}`);
    const rolled = await h.request('POST', `/workspaces/${h.w}/releases/${first.id}/rollback`, {
      expectedPublishedReleaseId: second.id,
      acknowledgeWarnings: true,
    });
    expect(rolled.statusCode, rolled.body).toBe(200);
    expect((await h.request('GET', `/workspaces/${h.w}/sources/${id}/asset`)).statusCode).toBe(404);
    const session = await visitor();
    const jobId = await ask(session);
    await drain();
    const answer = (
      await h.request('GET', `/public/jobs/${jobId}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data.result;
    expect(answer.disposition).toBe('handoff');
    expect(answer.evidence).toEqual([]);
    expect(
      (await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, { action: 'restore' })).statusCode,
    ).toBe(404);
  });
  it('retains published approved-answer dependencies when the draft dependency is edited', async () => {
    const dependency = await source('Policy basis: refunds take 7 days.');
    const created = await h.request('POST', `/workspaces/${h.w}/sources`, {
      title: 'Approved',
      kind: 'approved_answer',
      content: 'Refunds take 7 days.',
      authority: 'approved',
      dependsOnSourceIds: [dependency],
    });
    await drain();
    const approved = created.json().data.sourceId;
    const r = await release();
    await publishRelease(r.id);
    await h.request('PATCH', `/workspaces/${h.w}/sources/${approved}`, { dependsOnSourceIds: [] });
    await h.request('DELETE', `/workspaces/${h.w}/sources/${dependency}`);
    const session = await visitor();
    const jobId = await ask(session);
    await drain();
    const result = (
      await h.request('GET', `/public/jobs/${jobId}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data.result;
    expect(result.disposition).toBe('handoff');
    expect(result.evidence).toEqual([]);
  });
  it('does not let draft-only dependency edits invalidate a published release', async () => {
    const published = await source('The published policy is 30 days.');
    const draftOnlyDependency = await source('The draft-only dependency is 7 days.');
    const r = await release();
    await publishRelease(r.id);
    await h.request('PATCH', `/workspaces/${h.w}/sources/${published}`, {
      dependsOnSourceIds: [draftOnlyDependency],
    });
    await h.request('DELETE', `/workspaces/${h.w}/sources/${draftOnlyDependency}`);
    const session = await visitor();
    const jobId = await ask(session, 'What is the published policy?');
    await drain();
    const result = (
      await h.request('GET', `/public/jobs/${jobId}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data.result;
    expect(result.disposition).toBe('answer');
    expect(result.content).toContain('30 days');
  });
  it('atomic compare-and-swap rejects competing publication and database rejects release mutation', async () => {
    await source();
    const a = await release(),
      b = await release();
    const results = await Promise.all(
      [a, b].map((r) =>
        h.request('POST', `/workspaces/${h.w}/releases/${r.id}/publish`, {
          expectedPublishedReleaseId: null,
          acknowledgeWarnings: true,
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    await expect(
      db.tenant(h.w, (tx) =>
        tx.exec("UPDATE releases SET label='mutated' WHERE workspace_id=$1 AND id=$2", [h.w, a.id]),
      ),
    ).rejects.toThrow('immutable');
    const active = await db.tenant(h.w, (tx) =>
      tx.must('SELECT published_release_id FROM agents WHERE workspace_id=$1', [h.w]),
    );
    await expect(
      db.tenant(h.w, async (tx) => {
        await publish(tx, h.w, b.id, active.publishedReleaseId, true, h.owner);
        throw new Error('injected');
      }),
    ).rejects.toThrow('injected');
    expect(
      (
        await db.tenant(h.w, (tx) =>
          tx.must('SELECT published_release_id FROM agents WHERE workspace_id=$1', [h.w]),
        )
      ).publishedReleaseId,
    ).toBe(active.publishedReleaseId);
  });
  it('prefers approved answers and hands off unsupported questions with no evidence', async () => {
    await source('Refunds take 90 days.', 'reference');
    await source('Refunds take 7 days.', 'approved');
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    const jobId = await ask(session);
    await drain();
    const answer = (
      await h.request('GET', `/public/jobs/${jobId}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data.result;
    expect(answer.content).toContain('7 days');
    expect(answer.evidence.every((e: any) => e.authority === 'approved')).toBe(true);
    deps.ai = {
      ...deps.ai,
      embed: async (texts) =>
        texts.map(() => {
          const v = new Array(1536).fill(0);
          v[1] = 1;
          return v;
        }),
    };
    const unknown = await ask(session, 'Tell me about lunar geology');
    await drain();
    expect(
      (
        await h.request('GET', `/public/jobs/${unknown}`, undefined, session.token, {
          origin: 'https://customer.example',
        })
      ).json().data.result.disposition,
    ).toBe('handoff');
  });
});
describe('Metering, email and webhook retry safety', () => {
  it('fails an unconfigured AI operation without spending or billing, and enforces trial expiry', async () => {
    await source();
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    const before = await db.tenant(h.w, (tx) => usage(tx, h.w));
    deps.ai = openAI(testConfig);
    const id = await ask(session);
    await drain();
    const job = (
      await h.request('GET', `/public/jobs/${id}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data;
    expect(job.state).toBe('failed');
    expect(job.error.code).toBe('CONFIGURATION_ERROR');
    const after = await db.tenant(h.w, (tx) => usage(tx, h.w));
    expect(after.spentMicros).toBe(before.spentMicros);
    expect(after.used.reply).toBe(0);
    await db.tenant(h.w, (tx) =>
      tx.exec("UPDATE subscriptions SET period_end=now()-interval '1 second' WHERE workspace_id=$1", [h.w]),
    );
    await expect(
      db.tenant(h.w, (tx) => reserve(tx, h.w, 'expired', 'reply', 1, testConfig)),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_REQUIRED' });
  });
  it('fences an expired worker and marks its import visibly failed', async () => {
    const response = await h.request('POST', `/workspaces/${h.w}/sources`, {
      title: 'Lease test',
      kind: 'text',
      content: 'A bounded import',
    });
    const job = await claimJob(db);
    expect(job?.id).toBe(response.json().data.jobId);
    await db.tenant(h.w, (tx) =>
      tx.exec(
        "UPDATE jobs SET lease_until=now()-interval '1 second',max_attempts=attempts WHERE workspace_id=$1 AND id=$2",
        [h.w, job!.id],
      ),
    );
    await claimJob(db);
    await expect(db.tenant(h.w, (tx) => fence(tx, job!))).rejects.toMatchObject({ code: 'JOB_LEASE_LOST' });
    expect(
      (await h.request('GET', `/workspaces/${h.w}/sources/${response.json().data.sourceId}`)).json().data
        .source.processingState,
    ).toBe('failed');
  });
  it('commits the delivered reply, usage, and succeeded job before worker acknowledgement', async () => {
    await source();
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    const id = await ask(session);
    const claimed = await claimJob(db);
    expect(claimed?.id).toBe(id);
    await answerJob(db, testConfig, deps.ai, claimed!);
    const job = (
      await h.request('GET', `/public/jobs/${id}`, undefined, session.token, {
        origin: 'https://customer.example',
      })
    ).json().data;
    expect(job.state).toBe('succeeded');
    expect(job.result.content).toContain('30 days');
    expect((await db.tenant(h.w, (tx) => usage(tx, h.w))).used.reply).toBe(1);
  });
  it('does not charge a template fallback after an invalid model citation', async () => {
    await source();
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    deps.ai = {
      ...deps.ai,
      answer: async () => ({
        content: 'Unsupported',
        disposition: 'answer',
        citationIds: [randomUUID()],
        inputTokens: 100,
        outputTokens: 10,
        model: 'test-only',
      }),
    };
    const jobId = await ask(session);
    await drain();
    expect(
      (
        await h.request('GET', `/public/jobs/${jobId}`, undefined, session.token, {
          origin: 'https://customer.example',
        })
      ).json().data.result.disposition,
    ).toBe('handoff');
    expect((await db.tenant(h.w, (tx) => usage(tx, h.w))).used.reply).toBe(0);
  });
  it('serializes concurrent quota reservations and does not double-settle', async () => {
    await db.tenant(h.w, async (tx) => {
      await reserve(tx, h.w, 'prefill', 'reply', 1, testConfig, 99);
      await settle(tx, h.w, 'prefill', true, 1);
    });
    const results = await Promise.allSettled(
      ['a', 'b'].map((k) => db.tenant(h.w, (tx) => reserve(tx, h.w, k, 'reply', 1, testConfig))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const used = await db.tenant(h.w, (tx) => usage(tx, h.w));
    expect(used.used.reply + used.reserved.reply).toBe(100);
    await db.tenant(h.w, async (tx) => {
      await settle(tx, h.w, 'prefill', true, 1);
    });
    expect((await db.tenant(h.w, (tx) => usage(tx, h.w))).used.reply).toBe(99);
  });
  it('fails explicitly on spend exhaustion without a reservation', async () => {
    await h.request('PATCH', `/workspaces/${h.w}/settings`, { monthlySpendLimitMicros: 0 });
    await expect(
      db.tenant(h.w, (tx) => reserve(tx, h.w, 'limit', 'reply', 1, testConfig)),
    ).rejects.toMatchObject({ code: 'SPEND_LIMIT' });
    expect((await db.tenant(h.w, (tx) => usage(tx, h.w))).reserved.reply).toBe(0);
  });
  it('deduplicates logical escalation and provider delivery across ambiguous retries', async () => {
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    const key = randomUUID();
    const body = { email: 'visitor@example.com', message: 'Please help' };
    const create = () =>
      h.request('POST', '/public/handoff', body, session.token, {
        origin: 'https://customer.example',
        'idempotency-key': key,
      });
    const a = await create(),
      b = await create();
    expect(a.json().data).toEqual(b.json().data);
    const sends = new Map<string, string>();
    let first = true;
    deps.email = {
      send: async (key, payload) => {
        sends.set(key, json(payload));
        if (first) {
          first = false;
          throw new AppError('EMAIL_PROVIDER_ERROR', 'Ambiguous delivery', 503);
        }
        return 'receipt-test';
      },
    };
    await runOne(deps);
    const failed = await db.tenant(h.w, (tx) =>
      tx.must('SELECT * FROM escalations WHERE workspace_id=$1 AND id=$2', [h.w, a.json().data.escalationId]),
    );
    expect(failed.status).toBe('failed');
    expect(failed.sentAt).toBeNull();
    await db.tenant(h.w, (tx) => tx.exec('UPDATE jobs SET available_at=now() WHERE workspace_id=$1', [h.w]));
    await drain();
    const sent = await db.tenant(h.w, (tx) =>
      tx.must('SELECT * FROM escalations WHERE workspace_id=$1 AND id=$2', [h.w, a.json().data.escalationId]),
    );
    expect(sent.status).toBe('sent');
    expect(sent.attempts).toBe(2);
    expect(sends.size).toBe(1);
  });
  it('applies a subscription webhook once and ignores older state', async () => {
    await db.tenant(h.w, (tx) =>
      tx.exec('UPDATE subscriptions SET customer_id=$2 WHERE workspace_id=$1', [h.w, `cus_${h.w}`]),
    );
    const config = { ...testConfig, STRIPE_STARTER_PRICE_ID: 'price_starter' };
    const event = (id: string, created: number, status: string) =>
      ({
        id,
        type: 'customer.subscription.updated',
        created,
        data: {
          object: {
            id: `sub_${h.w}`,
            customer: `cus_${h.w}`,
            status,
            items: {
              data: [
                {
                  price: { id: 'price_starter' },
                  quantity: 1,
                  current_period_start: Math.floor(Date.now() / 1000),
                  current_period_end: Math.floor(Date.now() / 1000) + 86400,
                },
              ],
            },
          },
        },
      }) as any;
    const current = event(randomUUID(), 20, 'active');
    expect((await applyStripeEvent(db, config, current)).replayed).toBe(false);
    expect((await applyStripeEvent(db, config, current)).replayed).toBe(true);
    await applyStripeEvent(db, config, event(randomUUID(), 10, 'canceled'));
    expect((await db.tenant(h.w, (tx) => usage(tx, h.w))).status).toBe('active');
    expect(
      (await h.request('POST', '/webhooks/stripe', {}, h.owner, { 'stripe-signature': 'invalid' }))
        .statusCode,
    ).toBe(503);
  });
  it('verifies raw Stripe signatures, refetches canonical state, and deduplicates replay', async () => {
    const config = {
      ...testConfig,
      STRIPE_SECRET_KEY: 'sk_test_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_STARTER_PRICE_ID: 'price_starter',
    };
    await db.tenant(h.w, (tx) =>
      tx.exec('UPDATE subscriptions SET customer_id=$2 WHERE workspace_id=$1', [h.w, `cus_${h.w}`]),
    );
    const object = {
      id: `sub_${h.w}`,
      object: 'subscription',
      customer: `cus_${h.w}`,
      status: 'active',
      items: {
        data: [
          {
            price: { id: 'price_starter' },
            quantity: 1,
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
          },
        ],
      },
    };
    const payload = json({
      id: `evt_${randomUUID()}`,
      type: 'customer.subscription.updated',
      created: 100,
      data: { object },
    });
    const fetcher = vi.fn(
      async () => new Response(json(object), { headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetcher);
    const app = createApp({
      db,
      config,
      auth: { verify: async () => ({ id: h.owner, email: 'test@example.com' }) },
    });
    const signature = stripeClient(config).webhooks.generateTestHeaderString({
      payload,
      secret: config.STRIPE_WEBHOOK_SECRET,
    });
    const send = (signature: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        payload,
      });
    expect((await send('bad-signature')).statusCode).toBe(400);
    const first = await send(signature);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data.replayed).toBe(false);
    expect((await send(signature)).json().data.replayed).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await app.close();
  });
  it('creates Stripe checkout with a server-owned customer and price', async () => {
    const config = {
      ...testConfig,
      BILLING_ENABLED: 'true' as const,
      STRIPE_SECRET_KEY: 'sk_test_fixture',
      STRIPE_STARTER_PRICE_ID: 'price_configured',
    };
    const fetcher = vi.fn(async (url: any, _request: RequestInit) => {
      if (String(url).endsWith('/customers'))
        return new Response(json({ id: `cus_${h.w}`, object: 'customer' }), {
          headers: { 'content-type': 'application/json' },
        });
      return new Response(json({ id: 'cs_fixture', url: 'https://checkout.stripe.com/fixture' }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const app = createApp({
      db,
      config,
      auth: { verify: async (id) => ({ id, email: `${id}@example.com` }) },
    });
    const idempotencyKey = randomUUID();
    const send = (plan = 'starter', who = h.owner) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${h.w}/billing/checkout`,
        headers: { authorization: `Bearer ${who}`, 'idempotency-key': idempotencyKey },
        payload: { plan },
      });
    try {
      expect((await send('starter', h.member)).statusCode).toBe(403);
      const first = await send();
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().data).toEqual({ url: 'https://checkout.stripe.com/fixture' });
      expect((await send()).json().data).toEqual(first.json().data);
      expect((await send('growth')).statusCode).toBe(409);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(String(fetcher.mock.calls[0][0])).toBe('https://api.stripe.com/v1/customers');
      expect(String(fetcher.mock.calls[1][0])).toBe('https://api.stripe.com/v1/checkout/sessions');
      const request = new URLSearchParams(String(fetcher.mock.calls[1][1].body));
      expect(request.get('customer')).toBe(`cus_${h.w}`);
      expect(request.get('line_items[0][price]')).toBe('price_configured');
      expect(request.get('subscription_data[metadata][workspaceId]')).toBe(h.w);
      expect(request.get('success_url')).toBe(
        `${config.APP_ORIGIN}/settings?workspace=${h.w}&billing=success`,
      );
      expect(request.get('cancel_url')).toBe(
        `${config.APP_ORIGIN}/settings?workspace=${h.w}&billing=cancelled`,
      );
      expect(new Headers(fetcher.mock.calls[1][1].headers).get('idempotency-key')).toBe(
        `checkout-${h.w}-${idempotencyKey}`,
      );
    } finally {
      await app.close();
    }
  });
  it('returns from the Stripe portal to the same workspace and restricts access to owners', async () => {
    const config = { ...testConfig, BILLING_ENABLED: 'true' as const, STRIPE_SECRET_KEY: 'sk_test_fixture' };
    await db.tenant(h.w, (tx) =>
      tx.exec('UPDATE subscriptions SET customer_id=$2 WHERE workspace_id=$1', [h.w, `cus_${h.w}`]),
    );
    const fetcher = vi.fn(
      async (_url: any, _request: RequestInit) =>
        new Response(json({ id: 'bps_fixture', url: 'https://billing.stripe.com/fixture' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const app = createApp({
      db,
      config,
      auth: { verify: async (id) => ({ id, email: `${id}@example.com` }) },
    });
    const send = (who = h.owner) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${h.w}/billing/portal`,
        headers: { authorization: `Bearer ${who}` },
      });
    try {
      expect((await send(h.member)).statusCode).toBe(403);
      const result = await send();
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().data).toEqual({ url: 'https://billing.stripe.com/fixture' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(String(fetcher.mock.calls[0][0])).toBe('https://api.stripe.com/v1/billing_portal/sessions');
      const request = new URLSearchParams(String(fetcher.mock.calls[0][1].body));
      expect(request.get('customer')).toBe(`cus_${h.w}`);
      expect(request.get('return_url')).toBe(`${config.APP_ORIGIN}/settings?workspace=${h.w}`);
    } finally {
      await app.close();
    }
  });
  it('disables checkout and portal in pilot mode without contacting Stripe', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect((await h.request('GET', `/workspaces/${h.w}/settings`)).json().data.billingEnabled).toBe(false);
    for (const action of ['checkout', 'portal']) {
      const result = await h.request('POST', `/workspaces/${h.w}/billing/${action}`, { plan: 'starter' });
      expect(result.statusCode, result.body).toBe(503);
      expect(result.json().error.code).toBe('BILLING_DISABLED');
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await db.tenant(h.w, (tx) =>
        tx.must('SELECT customer_id FROM subscriptions WHERE workspace_id=$1', [h.w]),
      ),
    ).toEqual({ customerId: null });
  });
  it('reuses a completed visitor turn without a second response or charge', async () => {
    await source();
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    const idempotencyKey = randomUUID();
    const submit = () =>
      h.request('POST', '/public/messages', { question: 'Refund window?' }, session.token, {
        origin: 'https://customer.example',
        'idempotency-key': idempotencyKey,
      });
    const first = await submit();
    await drain();
    expect((await submit()).json().data).toEqual(first.json().data);
    await drain();
    expect((await db.tenant(h.w, (tx) => usage(tx, h.w))).used.reply).toBe(1);
  });
  it('releases stranded reservations without charging failed customer reply units', async () => {
    await db.tenant(h.w, async (tx) => {
      await reserve(tx, h.w, 'crashed:answer', 'reply', 500, testConfig);
      await tx.exec("UPDATE usage_events SET created_at=now()-interval '1 hour' WHERE workspace_id=$1", [
        h.w,
      ]);
    });
    await recoverSpend(db);
    const result = await db.tenant(h.w, (tx) => usage(tx, h.w));
    expect(result.reserved.reply).toBe(0);
    expect(result.used.reply).toBe(0);
    expect(result.spentMicros).toBe(500);
  });
});
describe('Comparison, maintenance and retention', () => {
  it('imports CSV baseline facts and requires explicit optimistic revisions of development cases', async () => {
    const csv =
      'question,previous_answer,expected_facts,importance,split\nRefund window?,90 days,"[""30 days""]",normal,development';
    expect((await h.request('POST', `/workspaces/${h.w}/evaluation/import`, { csv })).statusCode).toBe(202);
    await drain();
    const input = (await h.request('GET', `/workspaces/${h.w}/evaluation/cases`)).json().data.items[0];
    expect(input.expectedFacts).toEqual(['30 days']);
    expect(input.previousAnswer).toBe('90 days');
    const revised = {
      question: input.question,
      expectedFacts: ['60 days'],
      importance: 'normal',
      split: 'development',
    };
    expect(
      (
        await h.request('PATCH', `/workspaces/${h.w}/evaluation/cases/${input.id}`, {
          expectedRevision: 1,
          input: revised,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await h.request('PATCH', `/workspaces/${h.w}/evaluation/cases/${input.id}`, {
          expectedRevision: 1,
          input: revised,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await h.request('POST', `/workspaces/${h.w}/evaluation/cases`, { ...revised, split: 'holdout' }))
        .statusCode,
    ).toBe(409);
  });
  it('imports evaluation-only baselines, freezes run facts, and records human verdicts', async () => {
    await source('The refund window is 30 days.');
    const r = await release();
    const input = {
      question: 'What is the refund window?',
      previousAnswer: '90 days',
      expectedFacts: ['30 days'],
      importance: 'critical',
      split: 'holdout',
      baselineTimestamp: '2025-01-01T00:00:00Z',
    };
    const imported = await h.request('POST', `/workspaces/${h.w}/evaluation/import`, { cases: [input] });
    expect(imported.statusCode).toBe(202);
    await drain();
    const cases = (await h.request('GET', `/workspaces/${h.w}/evaluation/cases`)).json().data.items;
    expect(cases).toHaveLength(1);
    const run = await h.request('POST', `/workspaces/${h.w}/evaluation/runs`, { releaseId: r.id });
    await drain();
    const runId = (await h.request('GET', `/workspaces/${h.w}/jobs/${run.json().data.jobId}`)).json().data
      .result.runId;
    const detail = (await h.request('GET', `/workspaces/${h.w}/evaluation/runs/${runId}`)).json().data;
    expect(detail.run.state).toBe('succeeded');
    expect(detail.results[0].caseSnapshot.expectedFacts).toEqual(['30 days']);
    expect(detail.results[0].caseSnapshot.previousAnswer).toBe('90 days');
    expect(detail.run.limitations.length).toBeGreaterThan(0);
    expect(
      (
        await h.request('PATCH', `/workspaces/${h.w}/evaluation/cases/${cases[0].id}`, {
          expectedRevision: 1,
          input: { ...input, expectedFacts: ['90 days'] },
        })
      ).statusCode,
    ).toBe(409);
    const verdict = await h.request(
      'PUT',
      `/workspaces/${h.w}/evaluation/results/${detail.results[0].id}/verdict`,
      { verdict: 'candidate_better' },
    );
    expect(verdict.statusCode).toBe(200);
    expect(
      (await h.request('GET', `/workspaces/${h.w}/releases/${r.id}/checks`)).json().data.criticalUnreviewed,
    ).toBe(0);
    expect((await h.request('GET', `/workspaces/${h.w}/sources`)).json().data.items).toHaveLength(1);
    expect((await h.request('GET', `/workspaces/${h.w}/usage`)).json().data.used.check).toBe(1);
  });
  it('stages maintenance checks and auto-publishes only under the owner policy', async () => {
    const id = await source('Refunds take 30 days.');
    await h.request('PATCH', `/workspaces/${h.w}/settings`, { config: { autoPublish: true } });
    const first = await release();
    await publishRelease(first.id);
    const check = await h.request('POST', `/workspaces/${h.w}/evaluation/cases`, {
      question: 'How long do refunds take?',
      expectedFacts: ['60 days'],
      importance: 'normal',
      split: 'development',
      sourceIds: [id],
      control: true,
    });
    expect(check.statusCode).toBe(201);
    await h.request('PATCH', `/workspaces/${h.w}/sources/${id}`, { content: 'Refunds take 60 days.' });
    await drain();
    const completed = await db.tenant(h.w, (tx) =>
      tx.must(
        "SELECT id FROM jobs WHERE workspace_id=$1 AND kind='ingest' ORDER BY created_at DESC LIMIT 1",
        [h.w],
      ),
    );
    await db.tenant(h.w, (tx) =>
      enqueue(tx, h.w, 'maintenance_review', {
        phase: 'imports',
        imports: [{ sourceId: id, before: first.sourceVersionIds[0], jobId: completed.id }],
      }),
    );
    await drain();
    // A review job can be deferred behind its dependency; advance its test clock via available_at only.
    await db.tenant(h.w, (tx) =>
      tx.exec("UPDATE jobs SET available_at=now() WHERE workspace_id=$1 AND state='queued'", [h.w]),
    );
    await drain();
    const agent = await db.tenant(h.w, (tx) => tx.must('SELECT * FROM agents WHERE workspace_id=$1', [h.w]));
    expect(agent.publishedReleaseId).not.toBe(first.id);
    expect((await h.request('GET', `/workspaces/${h.w}/notifications`)).json().data.items).toHaveLength(1);
  });
  it('records check-quota exhaustion and prevents automatic publication', async () => {
    await source();
    await h.request('PATCH', `/workspaces/${h.w}/settings`, { config: { autoPublish: true } });
    const first = await release();
    await publishRelease(first.id);
    await h.request('POST', `/workspaces/${h.w}/evaluation/cases`, {
      question: 'refund window',
      expectedFacts: ['30 days'],
      importance: 'normal',
      split: 'development',
    });
    await db.tenant(h.w, async (tx) => {
      await reserve(tx, h.w, 'all-checks', 'check', 1, testConfig, 50);
      await settle(tx, h.w, 'all-checks', true, 1);
    });
    const second = await release();
    const run = await h.request('POST', `/workspaces/${h.w}/evaluation/runs`, { releaseId: second.id });
    await drain();
    await db.tenant(h.w, (tx) =>
      enqueue(tx, h.w, 'maintenance_review', {
        phase: 'checks',
        releaseId: second.id,
        checkJobId: run.json().data.jobId,
        baseReleaseId: first.id,
      }),
    );
    await drain();
    expect(
      (await db.tenant(h.w, (tx) => tx.must('SELECT * FROM agents WHERE workspace_id=$1', [h.w])))
        .publishedReleaseId,
    ).toBe(first.id);
    const checks = (await h.request('GET', `/workspaces/${h.w}/releases/${second.id}/checks`)).json().data;
    expect(checks.failures).toBeGreaterThan(0);
  });
  it('daily scheduling is idempotent and retention erases transcripts and session access', async () => {
    const r = await release();
    await publishRelease(r.id);
    const session = await visitor();
    await db.tenant(h.w, (tx) =>
      tx.exec("UPDATE conversations SET updated_at=now()-interval '31 days' WHERE workspace_id=$1", [h.w]),
    );
    await scheduleDaily(db);
    await scheduleDaily(db);
    const jobs = await db.system((tx) =>
      tx.rows("SELECT id FROM jobs WHERE workspace_id=$1 AND kind='maintenance'", [h.w]),
    );
    expect(jobs).toHaveLength(1);
    await drain();
    expect(
      (
        await h.request('GET', '/public/conversation', undefined, session.token, {
          origin: 'https://customer.example',
        })
      ).statusCode,
    ).toBe(401);
  });
  it('supports hosted iframe origins without allowing an arbitrary website to claim a parent', async () => {
    const r = await release();
    await publishRelease(r.id);
    const hosted = await h.request(
      'POST',
      '/public/sessions',
      { agentId: h.agent.id, parentOrigin: 'https://customer.example' },
      h.owner,
      { origin: testConfig.APP_ORIGIN },
    );
    expect(hosted.statusCode, hosted.body).toBe(201);
    expect(
      (
        await h.request('GET', '/public/conversation', undefined, hosted.json().data.token, {
          referer: `${testConfig.APP_ORIGIN}/widget`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await h.request(
          'POST',
          '/public/sessions',
          { agentId: h.agent.id, parentOrigin: 'https://customer.example' },
          h.owner,
          { origin: 'https://evil.example' },
        )
      ).statusCode,
    ).toBe(403);
  });
});
