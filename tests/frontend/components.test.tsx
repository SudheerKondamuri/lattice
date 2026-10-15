import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceList } from "@/components/evidence";
import { ErrorNotice } from "@/components/async-state";
import { ApiFailure } from "@/lib/api";
const evidence = { sourceId: "s", sourceVersionId: "published-old", chunkId: "c", title: "Old policy", authority: "authoritative" as const, excerpt: "Historical published passage", eligible: true, url: "javascript:alert(1)" };
describe("evidence and errors", () => {
  it("shows exact historical passage/version without reading a current draft", () => {
    render(<EvidenceList evidence={[evidence]} />);
    expect(screen.getByText("Historical published passage")).toBeVisible();
    expect(screen.getByText(/published-old/)).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("clears prior-turn evidence when a new answer has none", () => {
    const { rerender } = render(<EvidenceList evidence={[evidence]} />);
    rerender(<EvidenceList evidence={[]} />);
    expect(screen.queryByText("Historical published passage")).toBeNull();
    expect(screen.getByText(/No supporting source/)).toBeVisible();
  });
  it("does not expose ineligible evidence content", () => {
    render(<EvidenceList evidence={[{ ...evidence, eligible: false }]} />);
    expect(screen.queryByText("Historical published passage")).toBeNull();
    expect(screen.getByText(/revoked/i)).toBeVisible();
  });
  it("renders model/source HTML as text", () => {
    const { container } = render(<EvidenceList evidence={[{ ...evidence, excerpt: '<img src=x onerror="alert(1)">' }]} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img/)).toBeVisible();
  });
  it("shows expired session and request receipt without automatic retry", () => {
    const retry = vi.fn(); render(<ErrorNotice error={new ApiFailure(401, "SESSION_EXPIRED", "Expired", "r-12")} retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/sign in again/i);
    expect(screen.getByText(/r-12/)).toBeVisible(); expect(retry).not.toHaveBeenCalled();
  });
  it("offers actionable quota fallback", () => {
    render(<ErrorNotice error={new ApiFailure(429, "QUOTA_EXHAUSTED", "Exhausted")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/allowance/i);
  });
  it("does not direct an expired visitor session to dashboard authentication", () => {
    render(<ErrorNotice error={new ApiFailure(401, "UNAUTHORIZED", "Visitor session expired")} visitor/>);
    expect(screen.getByRole("alert")).toHaveTextContent(/support session/i);
    expect(screen.queryByRole("link", { name: "Sign in again" })).toBeNull();
  });
});
