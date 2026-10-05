import type { EvalResult } from "@/contracts/api";
export function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value,
  );
  return Number.isNaN(date.getTime())
    ? "Invalid date"
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}
export function safeUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function validateSourceEdit(title: string, content: string) {
  return !title.trim() || !content.trim()
    ? "Add a non-empty title and source content. Whitespace alone is not knowledge."
    : null;
}
export function comparisonCounts(
  results: Pick<EvalResult, "humanVerdict" | "error">[],
) {
  return {
    wins: results.filter(
      (r) => !r.error && r.humanVerdict === "candidate_better",
    ).length,
    losses: results.filter(
      (r) => !r.error && r.humanVerdict === "baseline_better",
    ).length,
    ties: results.filter((r) => !r.error && r.humanVerdict === "tie").length,
    failures: results.filter((r) => !!r.error).length,
    ungraded: results.filter(
      (r) => !r.error && (!r.humanVerdict || r.humanVerdict === "ungradable"),
    ).length,
  };
}
export function downloadJson(name: string, data: unknown) {
  downloadBlob(
    name,
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
}
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
