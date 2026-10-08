"use client";
import { useState, type FormEvent } from "react";
import type { EvalCase, EvalCaseInput } from "@/contracts/api";
import { useWorkspace } from "@/lib/store";
import { useTask } from "@/lib/resources";
import { Button, Modal } from "./ui";
import { TaskNotice } from "./async-state";
export function EvaluationEditor({
  existing,
  onClose,
}: {
  existing?: EvalCase;
  onClose: () => void;
}) {
  const { api, workspaceId: w, owner } = useWorkspace();
  const [question, setQuestion] = useState(existing?.question ?? ""),
    [facts, setFacts] = useState(existing?.expectedFacts.join("\n") ?? ""),
    [baseline, setBaseline] = useState(existing?.previousAnswer ?? ""),
    [timestamp, setTimestamp] = useState(existing?.baselineTimestamp ?? ""),
    [context, setContext] = useState(existing?.conversationContext ?? ""),
    [category, setCategory] = useState(existing?.category ?? ""),
    [split, setSplit] = useState<EvalCaseInput["split"]>(
      existing?.split ?? "development",
    ),
    [critical, setCritical] = useState(existing?.importance === "critical"),
    [control, setControl] = useState(existing?.control ?? false),
    [freeze, setFreeze] = useState(false);
  const task = useTask(`${w}:${existing?.id ?? "new"}`);
  async function save(e: FormEvent) {
    e.preventDefault();
    await task.run(async (signal) => {
      const expectedFacts = facts
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
      if (!question.trim() || !expectedFacts.length)
        throw new Error(
          "A question and explicitly reviewed expected facts are required.",
        );
      const input: EvalCaseInput = {
        question: question.trim(),
        expectedFacts,
        previousAnswer: baseline,
        conversationContext: context,
        sourceIds: existing?.sourceIds ?? [],
        category,
        importance: critical ? "critical" : "normal",
        split,
        control,
        ...(existing?.caseId ? { caseId: existing.caseId } : {}),
        ...(timestamp
          ? { baselineTimestamp: new Date(timestamp).toISOString() }
          : {}),
      };
      if (existing)
        await api.updateCase(
          w,
          existing.id,
          { expectedRevision: existing.revision, input, freeze },
          signal,
        );
      else await api.createCase(w, input, signal);
      if (!signal.aborted) onClose();
    });
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={
        existing ? "Review expected facts" : "Save an owner-approved check"
      }
      wide
    >
      <form className="import-form" onSubmit={save}>
        <label className="field">
          Question
          <textarea
            required
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={4000}
          />
        </label>
        <label className="field">
          Expected facts (one per line)
          <textarea
            required
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            maxLength={30000}
          />
        </label>
        <label className="field">
          Baseline answer
          <textarea
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
            maxLength={8000}
          />
        </label>
        <label className="field">
          Baseline timestamp (ISO, optional)
          <input
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
            placeholder="2026-10-05T12:00:00Z"
          />
        </label>
        <label className="field">
          Conversation context
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={8000}
          />
        </label>
        <label className="field">
          Category
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={100}
          />
        </label>
        <label className="field">
          Data split
          <select
            value={split}
            onChange={(e) => setSplit(e.target.value as typeof split)}
          >
            <option value="development">Development</option>
            <option value="holdout">Holdout</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={critical}
            onChange={(e) => setCritical(e.target.checked)}
          />{" "}
          Critical — human review required
        </label>
        <label>
          <input
            type="checkbox"
            checked={control}
            onChange={(e) => setControl(e.target.checked)}
          />{" "}
          Control question
        </label>
        {existing && split === "holdout" && (
          <label>
            <input
              type="checkbox"
              checked={freeze || existing.frozen}
              disabled={existing.frozen}
              onChange={(e) => setFreeze(e.target.checked)}
            />{" "}
            Freeze holdout (cannot subsequently edit)
          </label>
        )}
        <p>
          Expected facts change only with this explicit revision. Existing run
          snapshots never change. Evaluation data is not retrieval knowledge.
        </p>
        <TaskNotice task={task} />
        <Button disabled={task.busy || !owner || existing?.frozen}>
          Save explicit check revision
        </Button>
      </form>
    </Modal>
  );
}
