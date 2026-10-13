import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiFailure, apiPath } from "@/lib/api";
import { API_PATHS } from "@/contracts/api";

const fetcher = vi.fn<typeof fetch>();
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data, requestId: "receipt-1" }), { status });
let api: ApiClient;
beforeEach(() => { fetcher.mockReset(); api = new ApiClient(async () => "access-token", fetcher); });

describe("contract-backed transport", () => {
  it("invokes native browser fetch with the global receiver", async () => {
    const browserFetch = function (this: typeof globalThis) { if (this !== globalThis) throw new TypeError("Illegal invocation"); return Promise.resolve(ok({ user: {}, workspaces: [] })); } as typeof fetch;
    const client = new ApiClient(async () => "access-token", browserFetch);
    await expect(client.bootstrap()).resolves.toHaveProperty("workspaces");
  });
  it("encodes tenant IDs and refuses unresolved placeholders", () => {
    expect(apiPath(API_PATHS.source, { workspaceId: "tenant/a", sourceId: "s?" })).toBe("/workspaces/tenant%2Fa/sources/s%3F");
    expect(() => apiPath(API_PATHS.source, { workspaceId: "a" })).toThrow();
  });
  it("sends bearer credentials, cancellation and no-store", async () => {
    fetcher.mockResolvedValue(ok({ user: {}, workspaces: [] }));
    const controller = new AbortController();
    await api.bootstrap(controller.signal);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/v1/bootstrap");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-token");
    expect(init?.signal).toBe(controller.signal);
    expect(init?.cache).toBe("no-store");
  });
  it("does not turn a 202 into fabricated completion", async () => {
    fetcher.mockResolvedValue(ok({ jobId: "job-1" }, 202));
    expect(await api.preview("a", { question: "Q" })).toEqual({ jobId: "job-1" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Idempotency-Key")).toBeTruthy();
  });
  it.each([401, 403, 409, 429, 503])("preserves error status %i and backend receipt", async status => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { code: "BLOCKED", message: "Not permitted" }, requestId: "r2" }), { status }));
    await expect(api.bootstrap()).rejects.toMatchObject({ status, code: "BLOCKED", requestId: "r2" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never retries a failed chargeable mutation", async () => {
    fetcher.mockRejectedValue(new TypeError("offline"));
    await expect(api.preview("a", { question: "Q" })).rejects.toBeInstanceOf(ApiFailure);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed success envelopes", async () => {
    fetcher.mockResolvedValue(new Response('{"success":true}'));
    await expect(api.bootstrap()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("uses only the explicit published release ID, never a local corpus", async () => {
    fetcher.mockResolvedValue(ok({ jobId: "j" }, 202));
    await api.preview("a", { question: "Q", releaseId: "published-immutable" });
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ question: "Q", releaseId: "published-immutable" });
  });
  it("returns terminal failed jobs, not a simulated answer", async () => {
    fetcher.mockResolvedValue(ok({ id: "j", state: "failed", error: { code: "SOURCE_REVOKED", message: "Revoked" } }));
    await expect(api.waitForJob("a", "j")).rejects.toMatchObject({ code: "SOURCE_REVOKED" });
  });
  it("invalidates scoped resource subscribers only after a receipt", async () => {
    const listener = vi.fn(); api.subscribe(listener);
    fetcher.mockResolvedValue(ok({ deleted: true }));
    await api.deleteSource("a", "s");
    expect(listener).toHaveBeenCalledWith("/workspaces/a");
  });
});
