import Fastify, { type FastifyRequest, type HTTPMethods } from 'fastify';
import multipart from '@fastify/multipart';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Database, Tx, Row } from './db.js';
import { authorize, type Authenticator, type Identity } from './auth.js';
import { AppError, configured, publicError } from './errors.js';
import { enqueue, hash, idempotent, json, page, rateLimit } from './util.js';
import * as v from './validation.js';
import { createSource, deleteSource, sourceDetail, updateSource } from './sources.js';
import { publish, releaseChecks, releaseDetail, snapshot } from './releases.js';
import { createCase, createRun } from './evaluations.js';
import { conversationDetail, createHandoff, addFeedback, deleteConversation } from './conversations.js';
import { redactAnswer } from './answers.js';
import { usage } from './usage.js';
import { applyStripeEvent, checkout, stripeClient } from './billing.js';
import type { Answer, AgentConfig } from '../../src/contracts/api.js';
import { supabaseStorage, type AssetStorage } from './storage.js';

export interface AppDeps {
  db: Database;
  config: Config;
  auth: Authenticator;
  storage?: AssetStorage;
}
function token(request: FastifyRequest) {
  const match = request.headers.authorization?.match(/^Bearer (\S+)$/);
  if (!match) throw new AppError('UNAUTHORIZED', 'Bearer token required', 401);
  return match[1];
}
function key(request: FastifyRequest) {
  return z.string().min(8).max(128).parse(request.headers['idempotency-key']);
}
function requestOrigin(request: FastifyRequest) {
  if (request.headers.origin) return request.headers.origin;
  if (request.headers.referer) {
    try {
      return new URL(request.headers.referer).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
type Context = {
  tx: Tx;
  w: string;
  user: Identity;
  request: FastifyRequest;
  params: Record<string, string>;
  role: 'owner' | 'member';
};
export function createApp({ db, config, auth, storage = supabaseStorage(config) }: AppDeps) {
  const app = Fastify({
    bodyLimit: 2_000_000,
    requestTimeout: 30000,
    trustProxy:
      config.TRUST_PROXY === 'false' ? false : config.TRUST_PROXY.split(',').map((value) => value.trim()),
    genReqId: () => randomUUID(),
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body',
              'res.headers["set-cookie"]',
            ],
            serializers: {
              req: (r: any) => ({ id: r.id, method: r.method }),
              res: (r: any) => ({ statusCode: r.statusCode }),
            },
          },
  });
  app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1, fields: 8, parts: 9 } });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    if (request.url.split('?')[0] === '/api/v1/webhooks/stripe') {
      done(null, body);
      return;
    }
    try {
      done(null, JSON.parse(body.toString()));
    } catch {
      done(new AppError('INVALID_JSON', 'Request body is not valid JSON'));
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : (error as any).statusCode === 413
            ? 413
            : 500;
    const result =
      error instanceof z.ZodError
        ? {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }
        : error instanceof AppError
          ? { ...publicError(error), ...(error.details ? { details: error.details } : {}) }
          : status === 413
            ? { code: 'UPLOAD_TOO_LARGE', message: 'Request exceeds configured size limit' }
            : publicError(error);
    request.log.error({ requestId: request.id, code: result.code, status }, 'request failed');
    reply.code(status).send({ error: result, requestId: request.id });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' }, requestId: req.id }),
  );
  const success = (req: FastifyRequest, data: unknown) => ({ data, requestId: req.id });
  app.get('/healthz', async (req) => success(req, { status: 'ok' }));
  app.get('/readyz', async (req) => {
    try {
      await db.system(async (tx) => {
        await tx.exec('SELECT 1 FROM jobs LIMIT 0');
        const heartbeat = await tx.one(
          "SELECT id FROM worker_heartbeats WHERE last_seen>now()-interval '90 seconds' LIMIT 1",
        );
        if (!heartbeat) throw new AppError('NOT_READY', 'Worker heartbeat is missing or stale', 503);
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('NOT_READY', 'Database or migrations are unavailable', 503);
    }
    return success(req, { status: 'ready' });
  });
  function dashboard(
    method: HTTPMethods,
    path: string,
    owner: boolean,
    handler: (context: Context) => Promise<unknown>,
    status = 200,
  ) {
    app.route({
      method,
      url: `/api/v1/workspaces/:workspaceId${path}`,
      handler: async (request, reply) => {
        const user = await auth.verify(token(request));
        const params = request.params as Record<string, string>;
        const w = v.uuid.parse(params.workspaceId);
        for (const [name, value] of Object.entries(params)) if (name !== 'workspaceId') v.uuid.parse(value);
        const data = await db.tenant(w, async (tx) => {
          const role = await authorize(tx, w, user.id, owner);
          return handler({ tx, w, user, request, params, role });
        });
        reply.code(data && typeof data === 'object' && 'jobId' in data ? 202 : status);
        return success(request, data);
      },
    });
  }
  const once = (c: Context, operation: () => Promise<unknown>) =>
    idempotent(
      c.tx,
      c.w,
      c.user.id,
      key(c.request),
      { method: c.request.method, path: c.request.url.split('?')[0], body: c.request.body ?? null },
      operation,
    );
  app.get('/api/v1/bootstrap', async (request) => {
    const user = await auth.verify(token(request));
    const workspaces = await db.system(async (tx) => {
      await tx.exec(
        "INSERT INTO memberships(workspace_id,user_id,email,role) SELECT workspace_id,$1,$2,'member' FROM invitations WHERE email=$2 ON CONFLICT DO NOTHING",
        [user.id, user.email],
      );
      await tx.exec('DELETE FROM invitations WHERE email=$1', [user.email]);
      return tx.rows(
        'SELECT w.id,w.name,w.created_at,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at',
        [user.id],
      );
    });
    return success(request, { user, workspaces });
  });
  app.post('/api/v1/workspaces', async (request, reply) => {
    const user = await auth.verify(token(request));
    const idempotencyKey = key(request);
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        agentName: z.string().min(1).max(120),
        supportEmail: z.email(),
        websiteUrl: z.url().optional(),
      })
      .strict()
      .parse(request.body);
    const data = await db.system(async (tx) => {
      await tx.exec('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id]);
      const prior = await tx.one('SELECT * FROM bootstrap_keys WHERE user_id=$1 AND key=$2', [
        user.id,
        idempotencyKey,
      ]);
      if (prior) {
        if (prior.fingerprint !== hash(json(input)))
          throw new AppError('IDEMPOTENCY_CONFLICT', 'Key already used with different input', 409);
        const workspace = await tx.must("SELECT *, 'owner' role FROM workspaces WHERE id=$1", [
          prior.workspaceId,
        ]);
        return {
          workspace,
          agent: await tx.must('SELECT * FROM agents WHERE workspace_id=$1', [workspace.id]),
        };
      }
      const count = await tx.must('SELECT count(*)::int total FROM workspaces WHERE owner_id=$1', [user.id]);
      if (count.total >= config.TRIAL_WORKSPACES_PER_USER)
        throw new AppError('TRIAL_LIMIT', 'Workspace creation limit reached; contact support', 429);
      const workspace = await tx.must(
        "INSERT INTO workspaces(name,owner_id,spend_limit) VALUES($1,$2,$3) RETURNING id,name,created_at,'owner' role",
        [input.name, user.id, config.DEFAULT_MONTHLY_SPEND_MICROS],
      );
      await tx.exec("INSERT INTO memberships(workspace_id,user_id,email,role) VALUES($1,$2,$3,'owner')", [
        workspace.id,
        user.id,
        user.email,
      ]);
      const agentConfig: AgentConfig = {
        name: input.agentName,
        description: '',
        tone: 'Friendly and concise',
        instructions: '',
        supportEmail: input.supportEmail,
        handoffMessage: 'The team can help and will reply by email.',
        accentColor: '#3858e9',
        starterQuestions: [],
        allowedOrigins: input.websiteUrl ? [new URL(input.websiteUrl).origin] : [],
        autoPublish: false,
      };
      const agent = await tx.must('INSERT INTO agents(workspace_id,draft_config) VALUES($1,$2) RETURNING *', [
        workspace.id,
        json(agentConfig),
      ]);
      await tx.exec('INSERT INTO subscriptions(workspace_id) VALUES($1)', [workspace.id]);
      await tx.exec('INSERT INTO bootstrap_keys(user_id,key,fingerprint,workspace_id) VALUES($1,$2,$3,$4)', [
        user.id,
        idempotencyKey,
        hash(json(input)),
        workspace.id,
      ]);
      return { workspace, agent };
    });
    reply.code(201);
    return success(request, data);
  });
  dashboard('GET', '', false, async (c) => ({
    workspace: {
      ...(await c.tx.must('SELECT id,name,created_at FROM workspaces WHERE id=$1', [c.w])),
      role: c.role,
    },
    agent: await c.tx.must('SELECT * FROM agents WHERE workspace_id=$1', [c.w]),
  }));
  dashboard('GET', '/sources', false, async (c) => {
    const q = v.pagination.parse(c.request.query);
    const rows = await c.tx.rows(
      'SELECT id FROM sources WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
      [c.w, q.cursor ?? null, q.limit + 1],
    );
    return page(
      await Promise.all(rows.map(async (row) => (await sourceDetail(c.tx, c.w, row.id)).source)),
      q.limit,
    );
  });
  dashboard(
    'POST',
    '/sources',
    true,
    (c) =>
      once(c, () =>
        createSource(
          c.tx,
          c.w,
          v.sourceInput.parse(c.request.body),
          undefined,
          config.MAX_WORKSPACE_STORAGE_BYTES,
        ),
      ),
    202,
  );
  dashboard(
    'POST',
    '/sources/upload',
    true,
    async (c) => {
      const fields: Record<string, string> = {};
      let file: { bytes: Buffer; filename: string; mediaType: string } | undefined;
      for await (const part of c.request.parts()) {
        if (part.type === 'file') {
          file = {
            bytes: await part.toBuffer(),
            filename: part.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120),
            mediaType: part.mimetype,
          };
          if (part.file.truncated) throw new AppError('UPLOAD_TOO_LARGE', 'Upload exceeds size limit', 413);
        } else fields[part.fieldname] = String(part.value);
      }
      if (!file) throw new AppError('VALIDATION_ERROR', 'Upload file required');
      const input = v.sourceInput.parse({ ...fields, approvalRequired: fields.approvalRequired === 'true' });
      if (!['pdf', 'text', 'markdown', 'qa_csv', 'qa_xlsx'].includes(input.kind))
        throw new AppError('VALIDATION_ERROR', 'Unsupported upload kind');
      if (input.kind === 'pdf' && !file.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
        throw new AppError('INVALID_FILE', 'Expected a PDF file');
      if (input.kind === 'qa_xlsx' && (file.bytes.length < 4 || file.bytes.readUInt16LE(0) !== 0x4b50))
        throw new AppError('INVALID_FILE', 'Expected an XLSX ZIP file');
      return idempotent(
        c.tx,
        c.w,
        c.user.id,
        key(c.request),
        { path: 'upload', input, fileHash: hash(file.bytes) },
        () => createSource(c.tx, c.w, input, file, config.MAX_WORKSPACE_STORAGE_BYTES),
      );
    },
    202,
  );
  dashboard('GET', '/sources/:sourceId', false, (c) => sourceDetail(c.tx, c.w, c.params.sourceId));
  dashboard('PATCH', '/sources/:sourceId', true, (c) =>
    once(c, () =>
      updateSource(
        c.tx,
        c.w,
        c.params.sourceId,
        v.sourceUpdate.parse(c.request.body),
        config.MAX_WORKSPACE_STORAGE_BYTES,
      ),
    ),
  );
  dashboard('DELETE', '/sources/:sourceId', true, (c) => deleteSource(c.tx, c.w, c.params.sourceId));
  dashboard(
    'POST',
    '/sources/:sourceId/reprocess',
    true,
    (c) =>
      once(c, async () => {
        await c.tx.must("SELECT id FROM sources WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'", [
          c.w,
          c.params.sourceId,
        ]);
        return {
          ...(await enqueue(c.tx, c.w, 'ingest', { sourceId: c.params.sourceId })),
          sourceId: c.params.sourceId,
        };
      }),
    202,
  );
  async function queueQuestion(
    tx: Tx,
    w: string,
    input: z.infer<typeof v.question>,
    mode: 'preview' | 'visitor',
    session?: Row,
  ) {
    await rateLimit(tx, `${mode}:${session?.id ?? w}`, 20);
    let releaseId = input.releaseId;
    if (mode === 'visitor')
      releaseId = (await tx.must('SELECT published_release_id FROM agents WHERE workspace_id=$1', [w]))
        .publishedReleaseId;
    else if (!releaseId) releaseId = (await snapshot(tx, w, 'Draft preview')).id;
    if (!releaseId) throw new AppError('NOT_PUBLISHED', 'Agent has no published release', 409);
    await tx.must('SELECT id FROM releases WHERE workspace_id=$1 AND id=$2', [w, releaseId]);
    let conversationId = session?.conversationId ?? input.conversationId;
    if (conversationId)
      await tx.must('SELECT id FROM conversations WHERE workspace_id=$1 AND id=$2 AND mode=$3', [
        w,
        conversationId,
        mode,
      ]);
    else
      conversationId = (
        await tx.must('INSERT INTO conversations(workspace_id,mode) VALUES($1,$2) RETURNING id', [w, mode])
      ).id;
    const pending = await tx.one(
      "SELECT id FROM jobs WHERE workspace_id=$1 AND kind='answer' AND payload->>'conversationId'=$2 AND state IN ('queued','running')",
      [w, conversationId],
    );
    if (pending)
      throw new AppError(
        'TURN_PENDING',
        'Wait for the current response before sending another question',
        409,
      );
    const count = await tx.must(
      'SELECT count(*)::int total FROM messages WHERE workspace_id=$1 AND conversation_id=$2',
      [w, conversationId],
    );
    if (count.total >= 998) throw new AppError('CONVERSATION_LIMIT', 'Start a new conversation', 429);
    await tx.exec("INSERT INTO messages(workspace_id,conversation_id,role,content) VALUES($1,$2,'user',$3)", [
      w,
      conversationId,
      input.question,
    ]);
    return enqueue(
      tx,
      w,
      'answer',
      { question: input.question, releaseId, conversationId, mode },
      session?.id ?? null,
      1,
    );
  }
  dashboard(
    'POST',
    '/preview',
    false,
    (c) => once(c, () => queueQuestion(c.tx, c.w, v.question.parse(c.request.body), 'preview')),
    202,
  );
  dashboard('GET', '/conversations', false, async (c) => {
    const q = v.pagination.parse(c.request.query);
    return page(
      await c.tx.rows(
        `SELECT c.*,(SELECT count(*)::int FROM feedback f JOIN messages m ON m.workspace_id=f.workspace_id AND m.id=f.message_id WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id AND f.rating='unhelpful') unhelpful_count FROM conversations c WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id AND to_tsvector('english',m.content) @@ websearch_to_tsquery('english',$3))) ORDER BY id LIMIT $4`,
        [c.w, q.cursor ?? null, q.q ?? null, q.limit + 1],
      ),
      q.limit,
    );
  });
  dashboard('GET', '/conversations/:conversationId', false, (c) =>
    conversationDetail(c.tx, c.w, c.params.conversationId),
  );
  dashboard('DELETE', '/conversations/:conversationId', true, (c) =>
    deleteConversation(c.tx, c.w, c.params.conversationId),
  );
  dashboard('POST', '/conversations/:conversationId/feedback', false, (c) =>
    addFeedback(c.tx, c.w, c.params.conversationId, c.user.id, v.feedback.parse(c.request.body)),
  );
  dashboard(
    'POST',
    '/conversations/:conversationId/handoff',
    false,
    (c) =>
      once(c, () => createHandoff(c.tx, c.w, c.params.conversationId, v.handoff.parse(c.request.body), null)),
    202,
  );
  dashboard(
    'POST',
    '/escalations/:escalationId/retry',
    false,
    (c) =>
      once(c, async () => {
        const row = await c.tx.must('SELECT * FROM escalations WHERE workspace_id=$1 AND id=$2', [
          c.w,
          c.params.escalationId,
        ]);
        if (row.status === 'sent') throw new AppError('ALREADY_SENT', 'Escalation already delivered', 409);
        return {
          ...(await enqueue(c.tx, c.w, 'email', { escalationId: row.id })),
          escalationId: row.id,
          status: 'pending',
        };
      }),
    202,
  );
  dashboard('GET', '/evaluation/cases', false, async (c) => {
    const q = v.pagination.parse(c.request.query);
    const rows = await c.tx.rows(
      'SELECT * FROM eval_cases WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
      [c.w, q.cursor ?? null, q.limit + 1],
    );
    return page(
      rows.map((r) => ({
        ...r.input,
        id: r.id,
        revision: r.revision,
        frozen: r.frozen,
        createdAt: r.createdAt,
      })),
      q.limit,
    );
  });
  dashboard('POST', '/evaluation/cases', true, (c) => createCase(c.tx, c.w, c.request.body, c.user.id), 201);
  dashboard('PATCH', '/evaluation/cases/:caseId', true, async (c) => {
    const input = z
      .object({ expectedRevision: z.number().int(), input: v.caseInput, freeze: z.boolean().optional() })
      .strict()
      .parse(c.request.body);
    const old = await c.tx.must('SELECT * FROM eval_cases WHERE workspace_id=$1 AND id=$2', [
      c.w,
      c.params.caseId,
    ]);
    if (old.frozen || old.revision !== input.expectedRevision)
      throw new AppError('CASE_CONFLICT', 'Check is frozen or revision changed', 409);
    for (const source of input.input.sourceIds)
      await c.tx.must("SELECT id FROM sources WHERE workspace_id=$1 AND id=$2 AND status<>'deleted'", [
        c.w,
        source,
      ]);
    await c.tx.exec(
      'INSERT INTO eval_case_revisions(workspace_id,case_id,revision,input,actor_id) VALUES($1,$2,$3,$4,$5)',
      [c.w, old.id, old.revision + 1, json(input.input), c.user.id],
    );
    const row = await c.tx.must(
      'UPDATE eval_cases SET input=$3,revision=revision+1,frozen=$4 WHERE workspace_id=$1 AND id=$2 RETURNING *',
      [c.w, old.id, json(input.input), input.freeze ?? false],
    );
    return { ...row.input, id: row.id, revision: row.revision, frozen: row.frozen, createdAt: row.createdAt };
  });
  dashboard(
    'POST',
    '/evaluation/import',
    true,
    (c) =>
      once(c, () => {
        const input = z
          .object({
            cases: z.array(v.caseInput).min(1).max(500).optional(),
            csv: z.string().max(1_000_000).optional(),
          })
          .strict()
          .refine((x) => Boolean(x.cases) !== Boolean(x.csv), 'Supply cases or CSV')
          .parse(c.request.body);
        return enqueue(c.tx, c.w, 'eval_import', { ...input, actorId: c.user.id });
      }),
    202,
  );
  dashboard(
    'POST',
    '/evaluation/runs',
    true,
    (c) =>
      once(c, () => {
        const input = z
          .object({ releaseId: v.uuid, caseIds: z.array(v.uuid).min(1).max(500).optional() })
          .strict()
          .parse(c.request.body);
        return createRun(c.tx, c.w, input.releaseId, input.caseIds);
      }),
    202,
  );
  dashboard('GET', '/evaluation/runs', false, async (c) => {
    const q = v.pagination.parse(c.request.query);
    return page(
      await c.tx.rows(
        'SELECT * FROM eval_runs WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
        [c.w, q.cursor ?? null, q.limit + 1],
      ),
      q.limit,
    );
  });
  async function projectEval(tx: Tx, w: string, result: Row) {
    return { ...result, answer: result.answer ? await redactAnswer(tx, w, result.answer, true) : null };
  }
  dashboard('GET', '/evaluation/runs/:runId', false, async (c) => ({
    run: await c.tx.must('SELECT * FROM eval_runs WHERE workspace_id=$1 AND id=$2', [c.w, c.params.runId]),
    results: await Promise.all(
      (
        await c.tx.rows('SELECT * FROM eval_results WHERE workspace_id=$1 AND run_id=$2 ORDER BY id', [
          c.w,
          c.params.runId,
        ])
      ).map((r) => projectEval(c.tx, c.w, r)),
    ),
  }));
  dashboard('PUT', '/evaluation/results/:resultId/verdict', true, async (c) => {
    const input = z
      .object({ verdict: z.enum(['candidate_better', 'baseline_better', 'tie', 'ungradable']) })
      .strict()
      .parse(c.request.body);
    return projectEval(
      c.tx,
      c.w,
      await c.tx.must(
        'UPDATE eval_results SET human_verdict=$3,reviewed_by=$4 WHERE workspace_id=$1 AND id=$2 RETURNING *',
        [c.w, c.params.resultId, input.verdict, c.user.id],
      ),
    );
  });
  dashboard('GET', '/releases', false, async (c) => {
    const q = v.pagination.parse(c.request.query);
    const rows = await c.tx.rows(
      'SELECT id FROM releases WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
      [c.w, q.cursor ?? null, q.limit + 1],
    );
    return page(await Promise.all(rows.map((r) => releaseDetail(c.tx, c.w, r.id))), q.limit);
  });
  dashboard(
    'POST',
    '/releases',
    true,
    (c) =>
      once(c, () =>
        snapshot(
          c.tx,
          c.w,
          z
            .object({ label: z.string().min(1).max(120) })
            .strict()
            .parse(c.request.body).label,
        ),
      ),
    201,
  );
  dashboard('GET', '/releases/:releaseId', false, (c) => releaseDetail(c.tx, c.w, c.params.releaseId));
  dashboard('GET', '/releases/:releaseId/checks', false, (c) => releaseChecks(c.tx, c.w, c.params.releaseId));
  for (const mode of ['publish', 'rollback'] as const)
    dashboard('POST', `/releases/:releaseId/${mode}`, true, (c) => {
      const input = v.publishInput.parse(c.request.body);
      return publish(
        c.tx,
        c.w,
        c.params.releaseId,
        input.expectedPublishedReleaseId,
        input.acknowledgeWarnings,
        c.user.id,
        mode,
      );
    });
  async function settings(tx: Tx, w: string) {
    const workspace = await tx.must('SELECT * FROM workspaces WHERE id=$1', [w]);
    return {
      agent: await tx.must('SELECT * FROM agents WHERE workspace_id=$1', [w]),
      retentionDays: workspace.retentionDays,
      monthlySpendLimitMicros: Number(workspace.spendLimit),
      automaticOverages: false,
      revision: workspace.settingsRevision,
      billingEnabled: config.BILLING_ENABLED === 'true',
    };
  }
  dashboard('GET', '/settings', false, (c) => settings(c.tx, c.w));
  dashboard('PATCH', '/settings', true, async (c) => {
    const input = z
      .object({
        expectedRevision: z.number().int().positive(),
        config: v.agentConfig.partial().optional(),
        retentionDays: z.number().int().min(1).max(30).optional(),
        monthlySpendLimitMicros: z.number().int().min(0).max(1_000_000_000).optional(),
      })
      .strict()
      .parse(c.request.body);
    const current = await c.tx.must('SELECT settings_revision FROM workspaces WHERE id=$1 FOR UPDATE', [c.w]);
    if (current.settingsRevision !== input.expectedRevision)
      throw new AppError('SETTINGS_CONFLICT', 'Settings changed; refresh before saving', 409);
    if (input.config)
      await c.tx.exec(
        'UPDATE agents SET draft_config=draft_config||$2::jsonb,draft_revision=draft_revision+1 WHERE workspace_id=$1',
        [c.w, json(input.config)],
      );
    await c.tx.exec(
      'UPDATE workspaces SET retention_days=coalesce($2,retention_days),spend_limit=coalesce($3,spend_limit),settings_revision=settings_revision+1 WHERE id=$1 AND settings_revision=$4',
      [c.w, input.retentionDays ?? null, input.monthlySpendLimitMicros ?? null, input.expectedRevision],
    );
    return settings(c.tx, c.w);
  });
  dashboard('GET', '/members', false, (c) =>
    c.tx.rows('SELECT user_id,email,role FROM memberships WHERE workspace_id=$1 ORDER BY role,email', [c.w]),
  );
  dashboard(
    'POST',
    '/members',
    true,
    async (c) => {
      const input = z
        .object({ email: z.email(), role: z.literal('member') })
        .strict()
        .parse(c.request.body);
      const count = await c.tx.must(
        'SELECT (SELECT count(*) FROM memberships WHERE workspace_id=$1)+(SELECT count(*) FROM invitations WHERE workspace_id=$1) AS total',
        [c.w],
      );
      const limits = await usage(c.tx, c.w);
      if (Number(count.total) >= limits.limits.members)
        throw new AppError('MEMBER_LIMIT', 'Member allowance exhausted', 429);
      await c.tx.exec('INSERT INTO invitations(workspace_id,email) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        c.w,
        input.email.toLowerCase(),
      ]);
      return { email: input.email.toLowerCase(), role: 'member', status: 'pending' };
    },
    201,
  );
  dashboard('DELETE', '/members/:userId', true, async (c) => {
    const member = await c.tx.must('SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2', [
      c.w,
      c.params.userId,
    ]);
    if (member.role === 'owner')
      throw new AppError('OWNER_REQUIRED', 'Workspace owner cannot be removed', 409);
    await c.tx.exec('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2', [c.w, c.params.userId]);
    return { deleted: true };
  });
  dashboard('GET', '/usage', false, (c) => usage(c.tx, c.w));
  dashboard('POST', '/billing/checkout', true, (c) =>
    once(c, () => {
      if (config.BILLING_ENABLED !== 'true')
        throw new AppError('BILLING_DISABLED', 'Payments are deliberately disabled in pilot mode.', 503);
      return checkout(
        c.tx,
        c.w,
        z
          .object({ plan: z.enum(['starter', 'growth']) })
          .strict()
          .parse(c.request.body).plan,
        key(c.request),
        config,
      );
    }),
  );
  dashboard('POST', '/billing/portal', true, async (c) => {
    if (config.BILLING_ENABLED !== 'true')
      throw new AppError('BILLING_DISABLED', 'Payments are deliberately disabled in pilot mode.', 503);
    const row = await c.tx.must('SELECT customer_id FROM subscriptions WHERE workspace_id=$1', [c.w]);
    if (!row.customerId) throw new AppError('BILLING_NOT_STARTED', 'No billing customer exists', 409);
    const result = await stripeClient(config).billingPortal.sessions.create({
      customer: row.customerId,
      return_url: `${config.APP_ORIGIN}/settings?workspace=${encodeURIComponent(c.w)}`,
    });
    return { url: result.url };
  });
  async function jobView(tx: Tx, w: string, id: string, sessionId?: string) {
    const row = await tx.must(
      'SELECT id,kind,state,attempts,result,error,created_at,finished_at,payload FROM jobs WHERE workspace_id=$1 AND id=$2 AND ($3::uuid IS NULL OR session_id=$3)',
      [w, id, sessionId ?? null],
    );
    if (row.kind === 'answer' && row.result)
      row.result = await redactAnswer(
        tx,
        w,
        row.result as Answer,
        !sessionId && row.payload.mode === 'preview',
      );
    if (row.kind === 'ingest' && row.result?.sourceId)
      row.result = await sourceDetail(tx, w, row.result.sourceId);
    delete row.payload;
    if (!sessionId)
      row.steps = await tx.rows(
        'SELECT stage,state,details,started_at,finished_at FROM job_steps WHERE workspace_id=$1 AND job_id=$2 ORDER BY started_at,stage',
        [w, id],
      );
    return row;
  }
  dashboard('GET', '/jobs/:jobId', false, (c) => jobView(c.tx, c.w, c.params.jobId));
  dashboard('GET', '/notifications', false, async (c) => {
    const q = v.pagination.parse(c.request.query);
    return page(
      await c.tx.rows(
        'SELECT id,kind,summary,created_at,read_at FROM notifications WHERE workspace_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
        [c.w, q.cursor ?? null, q.limit + 1],
      ),
      q.limit,
    );
  });
  dashboard('GET', '/installations', false, async (c) =>
    c.tx.rows(
      'SELECT agent_id,site_origin,last_observed_at,loader_version,release_id,session_count FROM installations WHERE workspace_id=$1 ORDER BY last_observed_at DESC',
      [c.w],
    ),
  );
  app.post('/api/v1/public/sessions', async (request, reply) => {
    const input = z
      .object({
        agentId: v.uuid,
        parentOrigin: z.url().optional(),
        loaderVersion: z.string().max(40).default('unknown'),
      })
      .strict()
      .parse(request.body);
    const origin = z.url().parse(requestOrigin(request));
    const agent = await db.system((tx) =>
      tx.must(
        'SELECT a.*,r.config FROM agents a JOIN releases r ON r.workspace_id=a.workspace_id AND r.id=a.published_release_id WHERE a.id=$1',
        [input.agentId],
      ),
    );
    if (input.parentOrigin && origin !== new URL(config.APP_ORIGIN).origin)
      throw new AppError(
        'ORIGIN_FORBIDDEN',
        'Parent-origin sessions are restricted to the hosted iframe origin',
        403,
      );
    if (!agent.config.allowedOrigins.includes(input.parentOrigin ?? origin))
      throw new AppError('ORIGIN_FORBIDDEN', 'Website origin is not allowed', 403);
    const data = await db.tenant(agent.workspaceId, async (tx) => {
      await rateLimit(tx, `session:${hash(request.ip)}:${agent.id}`, 10);
      await rateLimit(tx, `agent:${agent.id}`, 1000);
      const conversation = await tx.must(
        "INSERT INTO conversations(workspace_id,mode) VALUES($1,'visitor') RETURNING id",
        [agent.workspaceId],
      );
      const opaque = randomBytes(32).toString('base64url');
      const session = await tx.must(
        "INSERT INTO sessions(workspace_id,agent_id,conversation_id,token_hash,origin,site_origin,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') RETURNING id,expires_at",
        [agent.workspaceId, agent.id, conversation.id, hash(opaque), origin, input.parentOrigin ?? origin],
      );
      await tx.exec('INSERT INTO installation_sessions(workspace_id,session_id) VALUES($1,$2)', [
        agent.workspaceId,
        session.id,
      ]);
      await tx.exec(
        `INSERT INTO installations(workspace_id,agent_id,site_origin,last_observed_at,loader_version,release_id,session_count) VALUES($1,$2,$3,now(),$4,$5,1) ON CONFLICT(workspace_id,agent_id,site_origin) DO UPDATE SET last_observed_at=now(),loader_version=excluded.loader_version,release_id=excluded.release_id,session_count=installations.session_count+1`,
        [
          agent.workspaceId,
          agent.id,
          input.parentOrigin ?? origin,
          input.loaderVersion,
          agent.publishedReleaseId,
        ],
      );
      const { name, accentColor, starterQuestions, handoffMessage, supportEmail } = agent.config;
      return {
        sessionId: session.id,
        token: opaque,
        expiresAt: session.expiresAt,
        conversationId: conversation.id,
        config: { name, accentColor, starterQuestions, handoffMessage, supportEmail },
      };
    });
    reply.code(201);
    return success(request, data);
  });
  async function session(request: FastifyRequest) {
    const row = await db.system((tx) =>
      tx.one('SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now()', [hash(token(request))]),
    );
    if (!row) throw new AppError('UNAUTHORIZED', 'Invalid or expired widget session', 401);
    if (requestOrigin(request) !== row.origin)
      throw new AppError('ORIGIN_FORBIDDEN', 'Widget session origin mismatch', 403);
    return row;
  }
  function widget(
    method: HTTPMethods,
    path: string,
    handler: (tx: Tx, s: Row, r: FastifyRequest) => Promise<unknown>,
    status = 200,
  ) {
    app.route({
      method,
      url: `/api/v1/public${path}`,
      handler: async (request, reply) => {
        const s = await session(request);
        const data = await db.tenant(s.workspaceId, async (tx) => {
          await tx.must('SELECT id FROM sessions WHERE workspace_id=$1 AND id=$2 AND expires_at>now()', [
            s.workspaceId,
            s.id,
          ]);
          return handler(tx, s, request);
        });
        reply.code(status);
        return success(request, data);
      },
    });
  }
  const widgetOnce = (tx: Tx, s: Row, r: FastifyRequest, fn: () => Promise<unknown>) =>
    idempotent(tx, s.workspaceId, s.id, key(r), { path: r.url, body: r.body }, fn);
  widget('GET', '/conversation', (tx, s) =>
    conversationDetail(tx, s.workspaceId, s.conversationId, true, s.id),
  );
  widget(
    'POST',
    '/messages',
    (tx, s, r) =>
      widgetOnce(tx, s, r, () =>
        queueQuestion(
          tx,
          s.workspaceId,
          z.object({ question: v.question.shape.question }).strict().parse(r.body),
          'visitor',
          s,
        ),
      ),
    202,
  );
  widget('POST', '/feedback', (tx, s, r) =>
    addFeedback(tx, s.workspaceId, s.conversationId, s.id, v.feedback.parse(r.body)),
  );
  widget(
    'POST',
    '/handoff',
    (tx, s, r) =>
      widgetOnce(tx, s, r, async () => {
        await rateLimit(tx, `handoff:${s.workspaceId}`, 20, 3600);
        return createHandoff(tx, s.workspaceId, s.conversationId, v.handoff.parse(r.body), s.id);
      }),
    202,
  );
  widget('GET', '/jobs/:jobId', (tx, s, r) =>
    jobView(tx, s.workspaceId, v.uuid.parse((r.params as Row).jobId), s.id),
  );
  async function asset(tx: Tx, w: string, sourceId: string, conversationId?: string): Promise<Row> {
    if (
      !(await tx.must('SELECT source_eligible($1,$2,$3) eligible', [w, sourceId, !conversationId])).eligible
    )
      throw new AppError('SOURCE_REVOKED', 'Source asset is no longer available', 404);
    let versionId: string;
    if (conversationId) {
      const citation = await tx.must(
        `SELECT e->>'sourceVersionId' version_id,m.release_id FROM messages m CROSS JOIN LATERAL jsonb_array_elements(evidence) e WHERE workspace_id=$1 AND conversation_id=$2 AND e->>'sourceId'=$3 ORDER BY created_at DESC LIMIT 1`,
        [w, conversationId, sourceId],
      );
      versionId = citation.versionId;
      if (
        !(
          await tx.must('SELECT release_eligible($1,$2,$3,false) eligible', [w, sourceId, citation.releaseId])
        ).eligible
      )
        throw new AppError('SOURCE_REVOKED', 'Source dependency was revoked', 404);
    } else
      versionId = (
        await tx.must('SELECT draft_version_id FROM sources WHERE workspace_id=$1 AND id=$2', [w, sourceId])
      ).draftVersionId;
    return tx.must(
      "SELECT a.bytes,a.filename,a.object_key,a.storage_state FROM assets a JOIN source_versions v ON v.workspace_id=a.workspace_id AND v.asset_id=a.id WHERE a.workspace_id=$1 AND a.source_id=$2 AND v.id=$3 AND a.storage_state='stored'",
      [w, sourceId, versionId],
    );
  }
  app.get('/api/v1/workspaces/:workspaceId/sources/:sourceId/asset', async (request, reply) => {
    const user = await auth.verify(token(request));
    const p = request.params as Row;
    const w = v.uuid.parse(p.workspaceId);
    const result: Row = await db.tenant(w, async (tx) => {
      await authorize(tx, w, user.id);
      const original = await asset(tx, w, v.uuid.parse(p.sourceId));
      return { ...original, bytes: await storage.get(original.objectKey) };
    });
    reply
      .type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${result.filename}"`);
    return Buffer.from(result.bytes);
  });
  app.get('/api/v1/public/sources/:sourceId/asset', async (request, reply) => {
    const s = await session(request);
    const result: Row = await db.tenant(s.workspaceId, async (tx) => {
      const original = await asset(
        tx,
        s.workspaceId,
        v.uuid.parse((request.params as Row).sourceId),
        s.conversationId,
      );
      return { ...original, bytes: await storage.get(original.objectKey) };
    });
    reply
      .type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${result.filename}"`);
    return Buffer.from(result.bytes);
  });
  app.post('/api/v1/webhooks/stripe', async (request) => {
    const signature = z.string().parse(request.headers['stripe-signature']);
    let event;
    try {
      event = stripeClient(config).webhooks.constructEvent(
        request.body as Buffer,
        signature,
        configured(config.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET'),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('INVALID_SIGNATURE', 'Invalid Stripe webhook signature', 400);
    }
    return success(
      request,
      await applyStripeEvent(db, config, event, (id) => stripeClient(config).subscriptions.retrieve(id)),
    );
  });
  return app;
}
