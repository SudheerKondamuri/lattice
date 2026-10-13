import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
if (typeof window !== "undefined") {
  // Node 25's built-in localStorage can shadow jsdom's browser Storage.
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, String(value)), removeItem: (key: string) => values.delete(key), clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null, get length() { return values.size; } });
}
afterEach(cleanup);
