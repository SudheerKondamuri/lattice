import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "@/lib/api";
import { useResource } from "@/lib/resources";
describe("workspace-scoped resources", () => {
  it("retains same-scope data during invalidation so pending jobs are not unmounted", async () => {
    const api = new ApiClient(async () => null);
    let resolve: ((value: string) => void) | undefined;
    const { result } = renderHook(() => useResource(api, "/workspaces/a", () => new Promise<string>(r => { resolve = r; })));
    await act(async () => { resolve!("tenant a"); });
    act(() => api.invalidate("/workspaces/a"));
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data).toBe("tenant a");
  });
  it("immediately hides old data when the auth client or workspace changes", async () => {
    const first = new ApiClient(async () => "user-a"), second = new ApiClient(async () => "user-b");
    const { result, rerender } = renderHook(({ api, key }) => useResource(api, key, () => api === first ? Promise.resolve("private a") : new Promise<string>(() => {})), { initialProps: { api: first, key: "/workspaces/a" } });
    await waitFor(() => expect(result.current.data).toBe("private a"));
    rerender({ api: second, key: "/workspaces/a" }); expect(result.current.data).toBeUndefined();
    rerender({ api: first, key: "/workspaces/b" }); expect(result.current.data).toBeUndefined();
  });
});
