import { beforeEach, describe, expect, it, vi } from "vitest";
import { readVisitor, saveVisitor, widgetStorageKey, readPending, savePending, clearPending } from "@/widget/storage";
const session = { sessionId: "public-session", token: "opaque-visitor", expiresAt: "2026-11-01T00:00:00Z", conversationId: "conversation", config: { name: "Public support", accentColor: "#2f6047", starterQuestions: [], supportEmail: "support@example.test", handoffMessage: "We reply by email" } };
beforeEach(() => localStorage.clear());
describe("durable visitor continuity", () => {
  it("retains accepted job receipts across reload without replaying a message or email", () => {
    const job = { jobId: "durable-job", sessionId: "public-session", kind: "answer" as const };
    savePending("a", "https://one.test", job);
    expect(readPending("a", "https://one.test", "public-session")).toEqual(job);
    expect(readPending("a", "https://other.test", "public-session")).toBeNull();
    expect(readPending("a", "https://one.test", "new-session")).toBeNull();
    clearPending("a", "https://one.test"); expect(readPending("a", "https://one.test", "public-session")).toBeNull();
  });
  it("stores only widget-owned session state and leaves old business preview untouched", () => { localStorage.setItem("lattice-workspace-v1", "legacy"); expect(saveVisitor("a", "https://one.test", session)).toBe(true); expect(readVisitor("a", "https://one.test")).toEqual(session); expect(readVisitor("b", "https://one.test")).toBeNull(); expect(localStorage.getItem("lattice-workspace-v1")).toBe("legacy"); });
  it("rejects malformed saved sessions without deleting the original value", () => { const key = widgetStorageKey("a", "https://one.test"); localStorage.setItem(key, "bad json"); expect(readVisitor("a", "https://one.test")).toBeNull(); expect(localStorage.getItem(key)).toBe("bad json"); localStorage.setItem(key, '{"config":{},"token":false}'); expect(readVisitor("a", "https://one.test")).toBeNull(); });
  it("reports blocked persistence honestly", () => { const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); }); expect(saveVisitor("a", "https://one.test", session)).toBe(false); spy.mockRestore(); const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); }); expect(readVisitor("a", "https://one.test")).toBeNull(); read.mockRestore(); });
});
