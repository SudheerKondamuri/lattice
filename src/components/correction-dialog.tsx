"use client";
import Link from "next/link";
import { useState } from "react";
import type { Message, SourceDetail } from "@/contracts/api";
import { useWorkspace, useWorkspaceHref } from "@/lib/store";
import { useTask } from "@/lib/resources";
import { validateSourceEdit } from "@/lib/presentation";
import { Modal, Button } from "./ui";
import { EvidenceList } from "./evidence";
import { TaskNotice } from "./async-state";
export function CorrectionDialog({
  question,
  message,
  onClose,
}: {
  question: string;
  message: Message;
  onClose: () => void;
}) {
  const { api, workspaceId: w, owner } = useWorkspace(),
    href = useWorkspaceHref();
  const [correction, setCorrection] = useState(""),
    [facts, setFacts] = useState(""),
    [approved, setApproved] = useState(false),
    [sourceId, setSourceId] = useState<string | null>(null),
    [caseId, setCaseId] = useState<string | null>(null);
  const task = useTask(`${w}:${message.id}`);
  async function stage() {
    const validation = validateSourceEdit(question, correction);
    if (validation) {
      task.setError(new Error(validation));
      return;
    }
    await task.run(async (signal) => {
      if (!approved)
        throw new Error(
          "Explicitly approve the customer-facing correction first.",
        );
      const accepted = await api.createSource(
        w,
        {
          title: question.slice(0, 200),
          kind: "approved_answer",
          content: correction.trim(),
          authority: "approved",
          approvalRequired: true,
          dependsOnSourceIds: [
            ...new Set(
              message.evidence.filter((e) => e.eligible).map((e) => e.sourceId),
            ),
          ],
        },
        signal,
      );
      task.setStatus(
        `Correction queued: ${accepted.jobId}. Existing evidence has not been rewritten.`,
      );
      const result = await api.waitForJob<SourceDetail>(
        w,
        accepted.jobId,
        signal,
        (job) => task.setStatus(`Correction job ${job.id}: ${job.state}`),
      );
      if (!signal.aborted) {
        setSourceId(result.source.id);
        task.setStatus(
          `Correction extracted: ${result.source.processingState}. Still draft, not published.`,
        );
      }
    });
  }
  async function save() {
    await task.run(async (signal) => {
      const expectedFacts = facts
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
      if (!question.trim() || !expectedFacts.length)
        throw new Error(
          "Provide the question and owner-approved expected facts (one per line).",
        );
      const check = await api.createCase(
        w,
        {
          question,
          previousAnswer: message.content,
          baselineTimestamp: message.createdAt,
          expectedFacts,
          sourceIds: sourceId
            ? [sourceId]
            : [
                ...new Set(
                  message.evidence
                    .filter((e) => e.eligible)
                    .map((e) => e.sourceId),
                ),
              ],
          importance: "normal",
          split: "development",
        },
        signal,
      );
      if (!signal.aborted) {
        setCaseId(check.id);
        task.setStatus(
          `Regression check saved with backend ID ${check.id}. It has not yet been run.`,
        );
      }
    });
  }
  return (
    <Modal open onClose={onClose} title="Fix the cause. Check the effect." wide>
      <div className="import-form">
        <h3>{question}</h3>
        <p className="source-text">{message.content}</p>
        <p>
          Original release: {message.releaseId ?? "Not recorded"}. Diagnostic
          suggestions are hypotheses, not hidden model reasoning.
        </p>
        <EvidenceList evidence={message.evidence} />
        <label className="field">
          Explicit approved correction (optional)
          <textarea
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            maxLength={1000000}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />{" "}
          I reviewed this customer-facing knowledge and its dependencies.
        </label>
        <Button
          variant="secondary"
          disabled={task.busy || !owner || !!sourceId}
          onClick={stage}
        >
          Stage new approved-answer correction
        </Button>
        <p>
          Conversations and evaluations are never added to knowledge
          automatically. This action creates a separate draft source; it does
          not edit historical evidence.
        </p>
        <label className="field">
          Owner-approved expected facts (one per line)
          <textarea
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            maxLength={30000}
          />
        </label>
        <Button disabled={task.busy || !owner || !!caseId} onClick={save}>
          Save regression check
        </Button>
        <TaskNotice task={task} />
        {caseId && (
          <Link
            className="button button-secondary"
            href={href(`/app/compare?case=${caseId}`)}
          >
            Run & review the check
          </Link>
        )}
        <Link className="subtle-link" href={href("/app/releases")}>
          Review checks before publishing
        </Link>
        {!owner && (
          <p className="state-notice">
            Only an owner can approve corrections or expected facts.
          </p>
        )}
      </div>
    </Modal>
  );
}
