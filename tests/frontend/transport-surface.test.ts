import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/api";
import type { EvalCaseInput } from "@/contracts/api";
const fetcher = vi.fn<typeof fetch>();
let api: ApiClient;
const envelope = (data: unknown) => new Response(JSON.stringify({ data, requestId: "test-receipt" }));
const evalInput: EvalCaseInput = { question: "Q", expectedFacts: ["Reviewed fact"], importance: "critical", split: "holdout" };
beforeEach(() => { fetcher.mockReset(); fetcher.mockImplementation(async () => envelope({ saved: true })); api = new ApiClient(async () => "test-token", fetcher); });
describe("typed API surface matches documented operations", () => {
  const calls: [string, string, (api: ApiClient) => Promise<unknown>][] = [
    ["POST", "/workspaces", a => a.createWorkspace({ name: "N", agentName: "A", supportEmail: "a@example.test" })],
    ["GET", "/workspaces/w", a => a.workspace("w")],
    ["GET", "/workspaces/w/sources?limit=100&cursor=next", a => a.sources("w", undefined, "next")],
    ["GET", "/workspaces/w/sources/s", a => a.source("w", "s")],
    ["POST", "/workspaces/w/sources", a => a.createSource("w", { title: "T", kind: "text", content: "Approved" })],
    ["POST", "/workspaces/w/sources/upload", a => a.upload("w", new FormData())],
    ["PATCH", "/workspaces/w/sources/s", a => a.updateSource("w", "s", { action: "archive", expectedRevision: 1 })],
    ["POST", "/workspaces/w/sources/s/reprocess", a => a.reprocess("w", "s")],
    ["GET", "/workspaces/w/conversations?limit=100&cursor=next&q=search", a => a.conversations("w", undefined, "next", "search")],
    ["GET", "/workspaces/w/conversations/c", a => a.conversation("w", "c")],
    ["DELETE", "/workspaces/w/conversations/c", a => a.deleteConversation("w", "c")],
    ["POST", "/workspaces/w/conversations/c/feedback", a => a.feedback("w", "c", { messageId: "m", rating: "helpful" })],
    ["POST", "/workspaces/w/conversations/c/handoff", a => a.handoff("w", "c", { email: "a@example.test" })],
    ["POST", "/workspaces/w/escalations/e/retry", a => a.retryEscalation("w", "e")],
    ["GET", "/workspaces/w/evaluation/cases?limit=100", a => a.evalCases("w")],
    ["POST", "/workspaces/w/evaluation/cases", a => a.createCase("w", evalInput)],
    ["PATCH", "/workspaces/w/evaluation/cases/c", a => a.updateCase("w", "c", { expectedRevision: 3, input: evalInput, freeze: true })],
    ["POST", "/workspaces/w/evaluation/import", a => a.importCases("w", { csv: "question\nQ" })],
    ["GET", "/workspaces/w/evaluation/runs?limit=100", a => a.evalRuns("w")],
    ["GET", "/workspaces/w/evaluation/runs/r", a => a.evalRun("w", "r")],
    ["POST", "/workspaces/w/evaluation/runs", a => a.runEvaluation("w", { releaseId: "immutable" })],
    ["PUT", "/workspaces/w/evaluation/results/r/verdict", a => a.verdict("w", "r", "baseline_better")],
    ["GET", "/workspaces/w/releases?limit=100", a => a.releases("w")],
    ["GET", "/workspaces/w/releases/r", a => a.release("w", "r")],
    ["POST", "/workspaces/w/releases", a => a.snapshot("w", "Reviewed update")],
    ["GET", "/workspaces/w/releases/r/checks", a => a.releaseChecks("w", "r")],
    ["POST", "/workspaces/w/releases/r/publish", a => a.publish("w", "r", { expectedPublishedReleaseId: "old", acknowledgeWarnings: true })],
    ["POST", "/workspaces/w/releases/r/rollback", a => a.publish("w", "r", { expectedPublishedReleaseId: "old", acknowledgeWarnings: false }, true)],
    ["GET", "/workspaces/w/settings", a => a.settings("w")],
    ["PATCH", "/workspaces/w/settings", a => a.updateSettings("w", { expectedRevision: 1, config: { tone: "Concise" } })],
    ["GET", "/workspaces/w/members", a => a.members("w")],
    ["POST", "/workspaces/w/members", a => a.invite("w", { email: "a@example.test", role: "member" })],
    ["DELETE", "/workspaces/w/members/u", a => a.removeMember("w", "u")],
    ["GET", "/workspaces/w/usage", a => a.usage("w")],
    ["POST", "/workspaces/w/billing/checkout", a => a.checkout("w", { plan: "starter" })],
    ["POST", "/workspaces/w/billing/portal", a => a.portal("w")],
    ["GET", "/workspaces/w/notifications?limit=100", a => a.notifications("w")],
    ["POST", "/public/sessions", a => a.widgetSession("agent")],
    ["GET", "/public/conversation", a => a.widgetConversation()],
    ["POST", "/public/messages", a => a.widgetMessage("Q")],
    ["POST", "/public/feedback", a => a.widgetFeedback({ messageId: "m", rating: "unhelpful" })],
    ["POST", "/public/handoff", a => a.widgetHandoff({ email: "a@example.test" })],
  ];
  it.each(calls)("%s %s", async (method, path, call) => { await call(api); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe(`/api/v1${path}`); expect(fetcher.mock.calls[0][1]?.method).toBe(method); });
   it("never attaches dashboard cookies or asserted origins to public widget requests", async () => { api = new ApiClient(async () => "opaque-visitor-token", fetcher, "https://site.test"); await api.widgetSession("agent"); expect(fetcher.mock.calls[0][1]?.credentials).toBe("omit"); expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("X-Widget-Site-Origin")).toBeNull(); expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ agentId: "agent", parentOrigin: "https://site.test", loaderVersion: "1" }); });
  it("polls documented public job endpoint and returns only the durable result", async () => { fetcher.mockImplementation(async () => envelope({ state: "succeeded", result: { messageId: "backend-issued" } })); expect(await api.waitForJob(null, "j")).toEqual({ messageId: "backend-issued" }); expect(fetcher.mock.calls[0][0]).toBe("/api/v1/public/jobs/j"); });
  it("polls queued → running → succeeded and reports actual states", async () => {
    vi.useFakeTimers(); const progress = vi.fn(); fetcher.mockResolvedValueOnce(envelope({ id: "j", state: "queued" })).mockResolvedValueOnce(envelope({ id: "j", state: "running" })).mockResolvedValueOnce(envelope({ id: "j", state: "succeeded", result: { completed: true } })); const promise = api.waitForJob("w", "j", undefined, progress, 10); await vi.runAllTimersAsync(); expect(await promise).toEqual({ completed: true }); expect(progress).toHaveBeenCalledTimes(3); vi.useRealTimers();
  });
  it("does not manufacture a result for a succeeded job with no payload", async () => { fetcher.mockResolvedValue(envelope({ state: "succeeded", result: null })); await expect(api.waitForJob("w", "j")).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); });
  it("reports bounded pending job and retains its durable ID", async () => { vi.useFakeTimers(); fetcher.mockImplementation(async () => envelope({ state: "running" })); const promise = api.waitForJob("w", "j", undefined, undefined, 1); const assertion = expect(promise).rejects.toMatchObject({ code: "JOB_PENDING", details: { jobId: "j" } }); await vi.runAllTimersAsync(); await assertion; vi.useRealTimers(); expect(fetcher).toHaveBeenCalledTimes(150); });
  it("stops status observation on abort without replaying the mutation", async () => { fetcher.mockResolvedValue(envelope({ state: "queued" })); const controller = new AbortController(); const promise = api.waitForJob("w", "j", controller.signal, () => controller.abort()); await expect(promise).rejects.toMatchObject({ name: "AbortError" }); expect(fetcher).toHaveBeenCalledTimes(1); });
  it("supports eligible original downloads and rejects revoked assets", async () => {
    fetcher.mockResolvedValueOnce(new Response("original")); expect(await (await api.asset("w", "s")).text()).toBe("original"); expect(fetcher.mock.calls[0][0]).toBe("/api/v1/workspaces/w/sources/s/asset");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "SOURCE_REVOKED", message: "Revoked" }, requestId: "r" }), { status: 410 })); await expect(api.asset(null, "s")).rejects.toMatchObject({ code: "SOURCE_REVOKED" }); expect(fetcher.mock.calls[1][0]).toBe("/api/v1/public/sources/s/asset");
  });
});
