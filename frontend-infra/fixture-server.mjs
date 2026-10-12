/** TEST ONLY. In-memory API/GoTrue doubles; never used by the application. */
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
if (process.env.LATTICE_FRONTEND_FIXTURES !== "1") throw new Error("This isolated test fixture requires LATTICE_FRONTEND_FIXTURES=1");
const now = () => new Date().toISOString();
const users = new Map(), workspaces = new Map(), sessions = new Map(), jobs = new Map();
const requests = [];
const uuid = value => { const hash = createHash("sha256").update(value).digest("hex"); return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`; };
const baseConfig = { name: "Fixture support", description: "Isolated synthetic data", tone: "Concise", instructions: "Use approved public knowledge", supportEmail: "support@example.test", handoffMessage: "Our team will reply by email.", accentColor: "#2f6047", starterQuestions: ["What is the export policy?"], allowedOrigins: ["http://localhost:3050", "http://127.0.0.1:4410"], autoPublish: false };
const tokenFor = user => `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, email: user.email, aud: "authenticated", role: "authenticated", iss: "http://127.0.0.1:4410/auth/v1", exp: Math.floor(Date.now()/1000) + 3600, iat: Math.floor(Date.now()/1000) })).toString("base64url")}.fixture-signature`;
const authUser = email => { let user = users.get(email); if (!user) { user = { id: uuid(email), email, aud: "authenticated", role: "authenticated", email_confirmed_at: now(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: now() }; users.set(email, user); } return user; };
const fromToken = token => { try { const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); if (payload.exp <= Date.now()/1000) return null; return [...users.values()].find(u => u.id === payload.sub) ?? null; } catch { return null; } };
function seedWorkspace(user, suffix, role = "owner", name = `Fixture ${suffix}`) {
  const id = uuid(`${user.id}:${suffix}`), agentId = uuid(`${id}:agent`), sourceId = uuid(`${id}:source`);
  const oldVersion = uuid(`${sourceId}:published`), draftVersion = uuid(`${sourceId}:draft`), releaseId = uuid(`${id}:release`);
  const workspace = { id, name, role, createdAt: now() };
  const source = { id: sourceId, workspaceId: id, title: `${suffix} export policy`, kind: "text", url: null, authority: "authoritative", approvalRequired: true, status: "active", held: false, draftVersionId: draftVersion, publishedVersionId: oldVersion, processingState: "ready", warnings: [], lastCheckedAt: "2026-10-05", createdAt: now() };
  const versions = [ { id: draftVersion, sourceId, contentHash: "draft-hash", content: "New draft export policy: 200 rows.", pageCount: 1, warnings: [], createdAt: now(), references: [] }, { id: oldVersion, sourceId, contentHash: "published-hash", content: "Old published export policy: 100 rows.", pageCount: 1, warnings: [], createdAt: "2026-10-04T00:00:00Z", references: [] } ];
  const agent = { id: agentId, workspaceId: id, draftConfig: { ...baseConfig }, publishedReleaseId: releaseId, draftRevision: 2 };
  const release = { id: releaseId, label: "Initial publication", config: { ...baseConfig }, sourceVersionIds: [oldVersion], draftRevision: 1, createdAt: now(), publishedAt: now() };
  const data = { userId: user.id, workspace, agent, sources: [source], versions: new Map([[sourceId, versions]]), releases: [release], cases: [], runs: [], conversations: [], members: [{ userId: user.id, email: user.email, role }], usage: { periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-11-01T00:00:00Z", plan: "trial", status: "trialing", limits: { replies: 100, checks: 50, sourcePages: 50, ocrPages: 10, members: 2 }, used: { reply: 0, check: 0, embedding: 0, ocr: 0, preview: 0 }, reserved: { reply: 0, check: 0, embedding: 0, ocr: 0, preview: 0 }, spentMicros: 0, reservedMicros: 0, monthlySpendLimitMicros: 10000000, automaticOverages: false } };
  workspaces.set(id, data); return data;
}
function bootstrap(user) {
  let owned = [...workspaces.values()].filter(w => w.userId === user.id);
  if (!owned.length && !user.email.startsWith("new-")) { seedWorkspace(user, "Owner", "owner", "Owner studio"); seedWorkspace(user, "Member", "member", "Member studio"); owned = [...workspaces.values()].filter(w => w.userId === user.id); }
  return { user: { id: user.id, email: user.email }, workspaces: owned.map(w => w.workspace) };
}
function queued(w, kind, result, failure = null) {
  const id = randomUUID(), job = { id, kind, state: "queued", attempts: 0, result: null, error: null, createdAt: now(), finishedAt: null, w };
  jobs.set(id, job);
  setTimeout(() => { job.state = failure ? "failed" : "succeeded"; job.error = failure; job.result = failure ? null : typeof result === "function" ? result() : result; job.attempts = 1; job.finishedAt = now(); }, 100);
  return { jobId: id };
}
function makeAnswer(w, question, releaseId, conversationId, mode = "preview") {
  let conversation = w.conversations.find(c => c.conversation.id === conversationId);
  if (!conversation) { conversation = { conversation: { id: conversationId || randomUUID(), mode, createdAt: now(), updatedAt: now() }, messages: [], escalations: [] }; w.conversations.unshift(conversation); }
  const source = w.sources.find(s => s.status === "active" && !s.held), release = w.releases.find(r => r.id === releaseId);
  const version = source && w.versions.get(source.id)?.find(v => v.id === (release?.sourceVersionIds.find(id => w.versions.get(source.id).some(v => v.id === id)) ?? source.draftVersionId));
  const evidence = source && version && !question.includes("unsupported") ? [{ sourceId: source.id, sourceVersionId: version.id, chunkId: randomUUID(), title: source.title, authority: source.authority, excerpt: version.content, eligible: true, section: "Export policy" }] : [];
  const answer = { conversationId: conversation.conversation.id, messageId: randomUUID(), releaseId: releaseId || uuid(`${w.workspace.id}:draft-${w.agent.draftRevision}`), content: evidence.length ? version.content : "Please contact support; no supporting source was found.", disposition: evidence.length ? "answer" : "handoff", evidence, model: "fixture-model-not-real-AI", promptVersion: "fixture-v1", createdAt: now() };
  conversation.messages.push({ id: randomUUID(), role: "user", content: question, releaseId: null, disposition: null, evidence: [], createdAt: now() }, { id: answer.messageId, role: "assistant", content: answer.content, releaseId: answer.releaseId, disposition: answer.disposition, evidence, createdAt: answer.createdAt }); return answer;
}
const page = (items, url) => { const cursor = url.searchParams.get("cursor"), limit = Number(url.searchParams.get("limit") || 100); const offset = cursor ? Math.max(0, items.findIndex(i => i.id === cursor) + 1) : 0; const slice = items.slice(offset, offset + limit); return { items: slice, nextCursor: items.length > offset + limit ? slice.at(-1).id : null }; };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4410"), path = url.pathname, method = req.method;
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*"); res.setHeader("Access-Control-Allow-Headers", "authorization,apikey,content-type,x-client-info,x-supabase-api-version"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  const raw = Buffer.concat(await Array.fromAsync(req));
  let input = {}; try { input = raw.length ? JSON.parse(raw.toString()) : {}; } catch { /* Multipart is parsed only in the upload branch. */ }
  const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  const ok = (data, status = 200) => json(status, { data, requestId: randomUUID() });
  const fail = (status, code, message) => json(status, { error: { code, message }, requestId: randomUUID() });
  if (method === "OPTIONS") return json(200, {});
  if (path === "/health") return json(200, { fixture: true });
  if (path === "/test/requests") return json(200, requests);
  const token = (req.headers.authorization || "").replace(/^Bearer /, ""), user = fromToken(token);
  if (path.startsWith("/auth/v1/")) {
    const result = u => ({ access_token: tokenFor(u), refresh_token: `fixture-refresh:${u.email}`, expires_in: 3600, expires_at: Math.floor(Date.now()/1000) + 3600, token_type: "bearer", user: u });
    if (path.endsWith("/token")) { const email = input.email || input.refresh_token?.replace("fixture-refresh:", "") || input.auth_code?.replace("fixture-code:", ""); if (!email || input.password === "wrong-password") return json(400, { error_code: "invalid_credentials", msg: "Invalid test credentials" }); return json(200, result(authUser(email))); }
    if (path.endsWith("/signup")) return json(200, { user: authUser(input.email) });
    if (path.endsWith("/recover")) return json(200, {});
    if (path.endsWith("/verify")) return json(200, result(authUser(input.token_hash?.replace("fixture-verify:", "") || "verified@example.test")));
    if (path.endsWith("/logout")) return json(200, {});
    if (path.endsWith("/user")) return user ? json(200, user) : json(401, { msg: "Session expired", code: "bad_jwt" });
    return json(404, { msg: "No such fixture auth route" });
  }
  if (path === "/staging") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<html><head><title>Isolated widget staging</title></head><body><h1>Staging installation</h1><script src="http://localhost:3050/lattice-widget.js" data-agent="${url.searchParams.get("agent") || ""}" defer></script></body></html>`); }
  if (!path.startsWith("/api/v1/")) return fail(404, "NOT_FOUND", "Fixture route not found");
  const route = path.slice(7).split("/").filter(Boolean);
  requests.push({ method, path, origin: req.headers.origin, cookieForwarded: !!req.headers.cookie, tokenKind: token.startsWith("visitor-") ? "visitor" : token ? "dashboard" : "none" });
  if (route[0] === "public") {
    if (route[1] === "sessions" && method === "POST") {
      const w = [...workspaces.values()].find(w => w.agent.id === input.agentId); if (!w) return fail(404, "NOT_FOUND", "Agent not found"); if (!w.agent.draftConfig.allowedOrigins.includes(input.parentOrigin || req.headers.origin)) return fail(403, "ORIGIN_BLOCKED", "Site origin is not allowed");
      const conversationId = randomUUID(), opaque = `visitor-${randomUUID()}`; w.conversations.unshift({ conversation: { id: conversationId, mode: "visitor", createdAt: now(), updatedAt: now() }, messages: [], escalations: [] });
      const session = { sessionId: randomUUID(), token: opaque, expiresAt: new Date(Date.now() + 86400000).toISOString(), conversationId, config: { ...w.agent.draftConfig } }; sessions.set(opaque, { session, w }); return ok(session, 201);
    }
    const visitor = sessions.get(token); if (!visitor) return fail(401, "SESSION_EXPIRED", "Public visitor session expired");
    const { w, session } = visitor;
    if (route[1] === "conversation") return ok(w.conversations.find(c => c.conversation.id === session.conversationId));
    if (route[1] === "messages") { if (input.question.includes("quota")) return fail(429, "QUOTA_EXHAUSTED", "Reply allowance exhausted"); return ok(queued(w.workspace.id, "answer", () => makeAnswer(w, input.question, w.agent.publishedReleaseId, session.conversationId, "visitor")), 202); }
    if (route[1] === "feedback") return ok({ saved: true });
    if (route[1] === "jobs") { const job = jobs.get(route[2]); return job?.w === w.workspace.id ? ok(job) : fail(404, "NOT_FOUND", "Job not found"); }
    if (route[1] === "handoff") { const escalation = { id: randomUUID(), conversationId: session.conversationId, status: "pending", email: input.email, attempts: 0, lastError: null, sentAt: null, createdAt: now() }; w.conversations.find(c => c.conversation.id === session.conversationId).escalations.push(escalation); const receipt = queued(w.workspace.id, "email", () => { escalation.status = input.email.startsWith("fail") ? "failed" : "sent"; escalation.lastError = escalation.status === "failed" ? "Sandbox delivery failure" : null; escalation.attempts = 1; escalation.sentAt = now(); return escalation; }); return ok({ ...receipt, escalationId: escalation.id, status: "pending" }, 202); }
    if (route[1] === "sources") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("Synthetic original source (not a historical version)."); }
    return fail(404, "NOT_FOUND", "Public fixture route not found");
  }
  if (!user) return fail(401, "SESSION_EXPIRED", "Dashboard session expired");
  if (route[0] === "bootstrap") return ok(bootstrap(user));
  if (route[0] === "workspaces" && route.length === 1 && method === "POST") { const w = seedWorkspace(user, randomUUID(), "owner", input.name); w.agent.draftConfig.name = input.agentName; w.agent.draftConfig.supportEmail = input.supportEmail; w.sources = []; w.releases = []; w.agent.publishedReleaseId = null; return ok({ workspace: w.workspace, agent: w.agent }, 201); }
  const w = workspaces.get(route[1]); if (!w || w.userId !== user.id) return fail(404, "NOT_FOUND", "Workspace is not accessible");
  if (route.length === 2) return ok({ workspace: w.workspace, agent: w.agent });
  if (method !== "GET" && w.workspace.role !== "owner" && !["preview", "conversations"].includes(route[2])) return fail(403, "OWNER_REQUIRED", "Only an owner can perform this action");
  if (route[2] === "jobs") { const job = jobs.get(route[3]); return job?.w === w.workspace.id ? ok(job) : fail(404, "NOT_FOUND", "Job not found"); }
  if (route[2] === "sources") {
    const detail = source => ({ source, versions: w.versions.get(source.id) || [] });
    if (route.length === 3 && method === "GET") return ok(page(w.sources, url));
    if ((route.length === 3 || route[3] === "upload") && method === "POST") {
      if (route[3] === "upload") { const form = raw.toString(); const field = name => form.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]+)`))?.[1]; input = { title: field("title"), kind: field("kind"), authority: field("authority"), content: "Extracted file text", approvalRequired: field("approvalRequired") === "true" }; }
      const source = { id: randomUUID(), workspaceId: w.workspace.id, title: input.title, kind: input.kind, url: input.url || null, authority: input.authority || "reference", approvalRequired: input.approvalRequired, status: "active", held: false, draftVersionId: null, publishedVersionId: null, processingState: "queued", warnings: [], lastCheckedAt: null, createdAt: now() }; w.sources.unshift(source); w.agent.draftRevision++;
      const isFailure = (input.url || "").includes("fail") || raw.toString().includes("FAIL_IMPORT");
      const receipt = queued(w.workspace.id, "ingest", () => { const version = { id: randomUUID(), sourceId: source.id, contentHash: "fixture-upload-hash", content: input.content || "Extracted website policy", pageCount: 1, warnings: [], createdAt: now(), references: [] }; source.draftVersionId = version.id; source.processingState = input.kind === "pdf" ? "partial" : "ready"; source.warnings = input.kind === "pdf" ? ["One scanned page could not be extracted"] : []; w.versions.set(source.id, [version]); return detail(source); }, isFailure ? { code: "IMPORT_FAILED", message: "Extraction failed in isolated fixture" } : null);
      if (isFailure) setTimeout(() => { source.processingState = "failed"; source.warnings = ["Extraction failed in isolated fixture"]; }, 120);
      return ok({ ...receipt, sourceId: source.id }, 202);
    }
    const source = w.sources.find(s => s.id === route[3]); if (!source) return fail(404, "NOT_FOUND", "Source not found");
    if (route[4] === "asset") { if (source.status === "deleted") return fail(410, "SOURCE_REVOKED", "Source revoked"); res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=fixture.txt" }); return res.end("Synthetic original source"); }
    if (route[4] === "reprocess") return ok({ ...queued(w.workspace.id, "ingest", detail(source)), sourceId: source.id }, 202);
    if (method === "DELETE") { source.status = "deleted"; source.held = true; source.draftVersionId = null; w.versions.set(source.id, (w.versions.get(source.id) || []).map(v => ({ ...v, content: "", references: [] }))); for (const c of w.conversations) for (const m of c.messages) m.evidence = m.evidence.map(e => e.sourceId === source.id ? { ...e, eligible: false, excerpt: "" } : e); return ok({ deleted: true }); }
    if (method === "PATCH") { if (input.action) source.status = input.action === "archive" ? "archived" : "active"; if (input.title) source.title = input.title; if (input.authority) source.authority = input.authority; w.agent.draftRevision++; return ok(source); }
    return ok(detail(source));
  }
  if (route[2] === "preview") { if (input.question.includes("quota")) return fail(429, "QUOTA_EXHAUSTED", "Preview allowance exhausted"); if (input.question.includes("revoked")) return ok(queued(w.workspace.id, "answer", null, { code: "SOURCE_REVOKED", message: "Source revoked during generation" }), 202); return ok(queued(w.workspace.id, "answer", () => makeAnswer(w, input.question, input.releaseId, input.conversationId)), 202); }
  if (route[2] === "conversations") {
    if (route.length === 3) { const q = url.searchParams.get("q")?.toLowerCase() || ""; return ok(page(w.conversations.filter(c => c.messages.some(m => m.content.toLowerCase().includes(q)) || !q).map(c => c.conversation), url)); }
    const conversation = w.conversations.find(c => c.conversation.id === route[3]); if (!conversation) return fail(404, "NOT_FOUND", "Conversation not found");
    if (method === "DELETE") { w.conversations = w.conversations.filter(c => c !== conversation); return ok({ deleted: true }); }
    if (route[4] === "feedback") return ok({ saved: true });
    if (route[4] === "handoff") { const escalation = { id: randomUUID(), conversationId: conversation.conversation.id, status: "pending", email: input.email, attempts: 0, lastError: null, sentAt: null, createdAt: now() }; conversation.escalations.push(escalation); return ok({ ...queued(w.workspace.id, "email", () => { escalation.status = "sent"; escalation.attempts = 1; escalation.sentAt = now(); return escalation; }), escalationId: escalation.id, status: "pending" }, 202); }
    return ok(conversation);
  }
  if (route[2] === "escalations") { const escalation = w.conversations.flatMap(c => c.escalations).find(e => e.id === route[3]); if (!escalation) return fail(404, "NOT_FOUND", "Escalation not found"); return ok({ ...queued(w.workspace.id, "email", () => { escalation.status = "sent"; escalation.attempts++; return escalation; }), escalationId: escalation.id, status: "pending" }, 202); }
  if (route[2] === "evaluation") {
    if (route[3] === "cases") {
      if (method === "POST") { const c = { ...input, id: randomUUID(), revision: 1, frozen: false, createdAt: now() }; w.cases.push(c); return ok(c, 201); }
      if (method === "PATCH") { const c = w.cases.find(c => c.id === route[4]); if (!c) return fail(404, "NOT_FOUND", "Check not found"); if (c.frozen || c.revision !== input.expectedRevision) return fail(409, "REVISION_CONFLICT", "Check changed or holdout frozen"); Object.assign(c, input.input, { revision: c.revision + 1, frozen: input.freeze || c.frozen }); return ok(c); }
      return ok(page(w.cases, url));
    }
    if (route[3] === "import") { const imported = input.cases || [{ question: "CSV fixture question", expectedFacts: ["100 rows"], importance: "normal", split: "development", previousAnswer: "Old baseline", baselineTimestamp: "2026-01-01T00:00:00Z" }]; return ok(queued(w.workspace.id, "eval-import", () => { w.cases.push(...imported.map(c => ({ ...c, id: randomUUID(), revision: 1, frozen: false, createdAt: now() }))); return { imported: imported.length }; }), 202); }
    if (route[3] === "runs") {
      if (method === "POST") {
        if (!w.releases.some(r => r.id === input.releaseId)) return fail(404, "RELEASE_MISSING", "Unknown immutable release");
        const run = { id: randomUUID(), releaseId: input.releaseId, state: "queued", jobId: "", createdAt: now(), limitations: ["Historical baseline may use older knowledge; automatic grading is preliminary."] }, detail = { run, results: [] }; w.runs.unshift(detail);
        const receipt = queued(w.workspace.id, "evaluation", () => { const selected = w.cases.filter(c => !input.caseIds || input.caseIds.includes(c.id)); detail.results = selected.map(c => { const error = c.question.includes("quota") ? "Check allowance exhausted; interrupted case" : null; return { id: randomUUID(), caseId: c.id, caseSnapshot: structuredClone(c), answer: error ? null : makeAnswer(w, c.question, input.releaseId, undefined, "evaluation"), deterministic: { missingFacts: [], eligibleCitations: true }, preliminaryGrade: { supported: true, fixture: true }, humanVerdict: null, reviewedBy: null, error }; }); run.state = detail.results.some(r => r.error) ? "failed" : "succeeded"; w.usage.used.check += detail.results.filter(r => !r.error).length; return { runId: run.id }; }); run.jobId = receipt.jobId; return ok(receipt, 202);
      }
      if (route[4]) { const run = w.runs.find(r => r.run.id === route[4]); return run ? ok(run) : fail(404, "NOT_FOUND", "Run not found"); }
      return ok(page(w.runs.map(r => r.run), url));
    }
    if (route[3] === "results") { const result = w.runs.flatMap(r => r.results).find(r => r.id === route[4]); if (!result) return fail(404, "NOT_FOUND", "Result not found"); result.humanVerdict = input.verdict; result.reviewedBy = user.id; return ok(result); }
  }
  if (route[2] === "releases") {
    const getChecks = id => { const run = w.runs.find(r => r.run.releaseId === id); const results = run?.results || []; return { releaseId: id, latestRunId: run?.run.id || null, failures: results.filter(r => r.error).length, regressions: results.filter(r => r.humanVerdict === "baseline_better").length, unreviewed: results.filter(r => !r.humanVerdict).length, criticalUnreviewed: results.filter(r => !r.humanVerdict && r.caseSnapshot.importance === "critical").length, warnings: !run ? ["No checks have been run for this release"] : results.filter(r => !r.humanVerdict).length ? ["Unreviewed cases require explicit acknowledgement"] : [] }; };
    if (route.length === 3 && method === "GET") return ok(page(w.releases, url));
    if (route.length === 3 && method === "POST") { const release = { id: randomUUID(), label: input.label, config: structuredClone(w.agent.draftConfig), sourceVersionIds: w.sources.filter(s => s.status === "active" && s.draftVersionId).map(s => s.draftVersionId), draftRevision: w.agent.draftRevision, createdAt: now(), publishedAt: null }; w.releases.unshift(release); return ok(release, 201); }
    const release = w.releases.find(r => r.id === route[3]); if (!release) return fail(404, "NOT_FOUND", "Release not found");
    if (route[4] === "checks") return ok(getChecks(release.id));
    if (route[4] === "publish" || route[4] === "rollback") { if (input.expectedPublishedReleaseId !== w.agent.publishedReleaseId) return fail(409, "PUBLISH_CONFLICT", "Published release changed"); if (getChecks(release.id).warnings.length && !input.acknowledgeWarnings) return fail(409, "REVIEW_REQUIRED", "Explicit review acknowledgement required"); if (route[4] === "rollback" && !release.publishedAt) return fail(409, "INVALID_ROLLBACK", "Not previously published"); w.agent.publishedReleaseId = release.id; release.publishedAt ||= now(); w.sources.forEach(s => { s.publishedVersionId = release.sourceVersionIds.find(id => w.versions.get(s.id)?.some(v => v.id === id)) || null; }); return ok(w.agent); }
    return ok(release);
  }
  if (route[2] === "settings") return ok({ agent: w.agent, retentionDays: 30, monthlySpendLimitMicros: w.usage.monthlySpendLimitMicros, automaticOverages: false });
  if (route[2] === "usage") return ok(w.usage);
  if (route[2] === "notifications") return ok({ items: [{ id: uuid(`${w.workspace.id}:notice`), kind: "source_review", summary: "Fixture source requires draft review", createdAt: now(), readAt: null }], nextCursor: null });
  if (route[2] === "members") { if (method === "POST") return ok({ pending: true }, 201); if (method === "DELETE") { w.members = w.members.filter(m => m.userId !== route[3]); return ok({ deleted: true }); } return ok(w.members); }
  if (route[2] === "billing") return fail(503, "CONFIGURATION_ERROR", "Payments are deliberately disabled in isolated frontend tests");
  return fail(404, "NOT_FOUND", "Fixture operation not implemented");
});
server.listen(4410, "127.0.0.1", () => console.log("Isolated frontend fixtures listening on 4410; no provider calls or customer emails"));
