"use client";
import { useEffect, useState } from "react";
import { downloadBlob } from "@/lib/presentation";
export function LegacyDataExport() {
  const [raw, setRaw] = useState<string | null>(null);
  useEffect(() => {
    try {
      setRaw(localStorage.getItem("lattice-workspace-v1"));
    } catch {
      /* Storage is optional; nothing is erased. */
    }
  }, []);
  if (!raw) return null;
  return (
    <section className="state-notice">
      <strong>Your previous browser preview is preserved.</strong>
      <p>
        It is not used as live workspace data and has not been uploaded or
        deleted. Export it, review it, and explicitly import approved text/Q&A
        through Knowledge.
      </p>
      <button
        className="button button-secondary"
        onClick={() =>
          downloadBlob(
            "lattice-browser-preview.json",
            new Blob([raw], { type: "application/json" }),
          )
        }
      >
        Export previous preview
      </button>
    </section>
  );
}
