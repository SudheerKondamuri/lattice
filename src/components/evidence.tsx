"use client";
import type { Evidence } from "@/contracts/api";
import { safeUrl } from "@/lib/presentation";
export function EvidenceList({
  evidence,
  inspect,
  inspectLabel = "Inspect exact source version",
}: {
  evidence: Evidence[];
  inspect?: (sourceId: string, versionId: string) => void;
  inspectLabel?: string;
}) {
  if (!evidence.length)
    return (
      <p className="state-notice">
        No supporting source returned for this turn.
      </p>
    );
  return (
    <div className="evidence-list">
      {evidence.map((item, index) => (
        <article key={`${item.chunkId}:${index}`} className="evidence-entry">
          <strong>
            [{index + 1}] {item.title}
          </strong>
          <small>
            Source version: {item.sourceVersionId} · {item.authority}
            {item.page ? ` · page ${item.page}` : ""}
            {item.section ? ` · ${item.section}` : ""}
          </small>
          {item.eligible ? (
            <>
              <blockquote>{item.excerpt}</blockquote>
              {safeUrl(item.url) && (
                <a
                  href={safeUrl(item.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="subtle-link"
                >
                  Open source URL
                </a>
              )}
              {inspect && (
                <button
                  className="button button-secondary"
                  onClick={() => inspect(item.sourceId, item.sourceVersionId)}
                >
                  {inspectLabel}
                </button>
              )}
            </>
          ) : (
            <p role="status">
              Source revoked or withheld. This passage is no longer available.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
