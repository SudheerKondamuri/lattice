// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardRequest } from "@/lib/forward";
afterEach(() => vi.unstubAllGlobals());
describe("same-origin relay", () => {
  it("reports missing configuration rather than returning fake data", async () => {
    const response = await forwardRequest(new Request("https://app.test/api/v1/bootstrap"), ["bootstrap"], "");
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("CONFIGURATION_ERROR");
  });
  it("forwards bearer and multipart body but no cookies or service credentials", async () => {
    const remote = vi.fn().mockResolvedValue(new Response('{"data":{},"requestId":"r"}'));
    vi.stubGlobal("fetch", remote);
    const body = new FormData(); body.set("file", new Blob(["text"]), "source.txt");
    await forwardRequest(new Request("https://app.test/api/v1/workspaces/a/sources/upload", { method: "POST", headers: { Authorization: "Bearer test", Cookie: "private=secret", "Idempotency-Key": "test-key" }, body }), ["workspaces", "a", "sources", "upload"], "http://localhost:4000");
    const headers = new Headers(remote.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer test");
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("content-type")).toContain("multipart/form-data");
    expect(remote.mock.calls[0][1].redirect).toBe("manual");
  });
  it("does not substitute an asserted site origin for the hosted iframe origin", async () => {
    const remote = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal("fetch", remote);
    const request = () => new Request("https://app.test/api/v1/bootstrap", { headers: { Origin: "https://app.test", "X-Widget-Site-Origin": "https://site.test" } });
    await forwardRequest(request(), ["public", "sessions"], "http://localhost:4000");
    expect(new Headers(remote.mock.calls[0][1].headers).get("Origin")).toBe("https://app.test");
    await forwardRequest(request(), ["bootstrap"], "http://localhost:4000");
    expect(new Headers(remote.mock.calls[1][1].headers).get("Origin")).toBe("https://app.test");
  });
  it("supplies the sanitized iframe referrer origin for public GET polling", async () => {
    const remote = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal("fetch", remote);
    await forwardRequest(new Request("https://app.test/api/v1/public/jobs/j", { headers: { Referer: "https://app.test/widget?agent=a&site=https://site.test" } }), ["public", "jobs", "j"], "http://localhost:4000");
    expect(new Headers(remote.mock.calls[0][1].headers).get("Origin")).toBe("https://app.test");
    expect(new Headers(remote.mock.calls[0][1].headers).get("Referer")).toBeNull();
  });
  it.each([["..", "healthz"], ["webhooks", "stripe"], ["public", ".."], ["private"]])("rejects arbitrary forwarding %j", async (...path) => {
    const response = await forwardRequest(new Request("https://app.test/api/v1"), path as string[], "http://localhost:4000"); expect(response.status).toBe(400);
  });
  it("keeps backend errors and receipts intact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"code":"QUOTA_EXHAUSTED","message":"No allowance"},"requestId":"upstream"}', { status: 429 })));
    const response = await forwardRequest(new Request("https://app.test/api/v1/bootstrap"), ["bootstrap"], "http://localhost:4000");
    expect(response.status).toBe(429); expect((await response.json()).requestId).toBe("upstream"); expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
