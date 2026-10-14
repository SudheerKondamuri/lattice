import { describe, expect, it } from "vitest";
import { formatDate, safeUrl, validateSourceEdit, comparisonCounts } from "@/lib/presentation";
import { widgetStorageKey } from "@/widget/storage";
import type { EvalResult } from "@/contracts/api";
describe("safe presentation", () => {
  it("renders date-only values identically across server/browser zones", () => expect(formatDate("2026-10-05")).toBe("Oct 5, 2026"));
  it("rejects whitespace-only source edits", () => expect(validateSourceEdit(" Title ", " \n\t ")).toBeTruthy());
  it("accepts useful text", () => expect(validateSourceEdit("Title", "Approved policy")).toBeNull());
  it.each(["javascript:alert(1)", "data:text/html,hi", "//evil.test"])('rejects unsafe URL %s', url => expect(safeUrl(url)).toBeNull());
  it("allows only http(s) links", () => expect(safeUrl("https://docs.example.com/a")).toBe("https://docs.example.com/a"));
  it("keeps visitor storage scoped by agent AND installation site", () => {
    expect(widgetStorageKey("a", "https://one.test")).not.toBe(widgetStorageKey("a", "https://two.test"));
    expect(widgetStorageKey("a", "https://one.test")).not.toBe(widgetStorageKey("b", "https://one.test"));
  });
  it("keeps failures and ungraded results visible", () => {
    const results: Pick<EvalResult, "humanVerdict" | "error">[] = [ { humanVerdict: "candidate_better", error: null }, { humanVerdict: "baseline_better", error: null }, { humanVerdict: "tie", error: null }, { humanVerdict: null, error: null }, { humanVerdict: null, error: "Quota exhausted" } ];
    expect(comparisonCounts(results)).toEqual({ wins: 1, losses: 1, ties: 1, failures: 1, ungraded: 1 });
  });
});
