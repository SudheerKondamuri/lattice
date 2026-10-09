"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EvalCase, EvalCaseInput, HumanVerdict } from "@/contracts/api";
import { useWorkspace } from "@/lib/store";
import { useResource, useTask } from "@/lib/resources";
import { comparisonCounts, formatDate } from "@/lib/presentation";
import { Badge, Button, Empty, PageHeader } from "../ui";
import { ErrorNotice, Loading, TaskNotice } from "../async-state";
import { EvidenceList } from "../evidence";
import { EvaluationEditor } from "../evaluation-editor";
export function Compare() {
  const { api, workspaceId: w, owner } = useWorkspace(),
    params = useSearchParams(),
    router = useRouter();
  const [cursor, setCursor] = useState<string | undefined>(),
    [runCursor, setRunCursor] = useState<string | undefined>(),
    [selected, setSelected] = useState<string[]>([]),
    [releaseChoice, setReleaseChoice] = useState(params.get("release") ?? ""),
    [editor, setEditor] = useState<EvalCase | "new" | null>(null);
  const cases = useResource(
    api,
    `/workspaces/${w}/evaluation/cases?cursor=${cursor ?? ""}`,
    (s) => api.evalCases(w, s, cursor),
  );
  const runs = useResource(
    api,
    `/workspaces/${w}/evaluation/runs?cursor=${runCursor ?? ""}`,
    (s) => api.evalRuns(w, s, runCursor),
  );
  const releases = useResource(api, `/workspaces/${w}/releases`, (s) =>
    api.releases(w, s),
  );
  const usage = useResource(api, `/workspaces/${w}/usage`, (s) =>
    api.usage(w, s),
  );
  const runId = params.get("run"),
    run = useResource(
      api,
      runId ? `/workspaces/${w}/evaluation/runs/${runId}` : null,
      (s) => api.evalRun(w, runId!, s),
    );
  const task = useTask(`${w}:${runId ?? "list"}`);
  function showRun(id: string) {
    const next = new URLSearchParams(params);
    next.set("run", id);
    router.push(`/app/compare?${next}`, { scroll: false });
  }
  useEffect(() => {
    if (run.data && ["queued", "running"].includes(run.data.run.state)) {
      const timer = setTimeout(run.reload, 1500);
      return () => clearTimeout(timer);
    }
  }, [run.data, run.reload]);
  async function importFile(file?: File) {
    if (!file) return;
    await task.run(async (signal) => {
      if (file.size > 1000000)
        throw new Error("Case imports are limited to 1 MB by the API.");
      const text = await file.text();
      if (signal.aborted) return;
      let body;
      if (/\.csv$/i.test(file.name)) body = { csv: text };
      else if (/\.json$/i.test(file.name)) {
        const parsed: unknown = JSON.parse(text);
        const cases = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === "object" && "cases" in parsed
            ? (parsed as { cases: unknown }).cases
            : null;
        if (!Array.isArray(cases))
          throw new Error(
            "JSON must contain a cases array matching the API EvalCaseInput schema.",
          );
        body = { cases: cases as EvalCaseInput[] };
      } else throw new Error("Choose a CSV or JSON case file.");
      const accepted = await api.importCases(w, body, signal);
      task.setStatus(
        `Case import queued: ${accepted.jobId}. Imported cases are not knowledge.`,
      );
      const receipt = await api.waitForJob<{ imported: number }>(
        w,
        accepted.jobId,
        signal,
        (job) => task.setStatus(`Case import ${job.id}: ${job.state}`),
      );
      if (!signal.aborted)
        task.setStatus(`${receipt.imported} cases imported by the backend.`);
    });
  }
  async function evaluate() {
    await task.run(async (signal) => {
      if (!releaseChoice)
        throw new Error("Choose a backend-issued immutable release snapshot.");
      const accepted = await api.runEvaluation(
        w,
        {
          releaseId: releaseChoice,
          ...(selected.length ? { caseIds: selected } : {}),
        },
        signal,
      );
      task.setStatus(
        `Evaluation accepted: ${accepted.jobId}. Each completed case consumes check allowance.`,
      );
      const receipt = await api.waitForJob<{ runId: string }>(
        w,
        accepted.jobId,
        signal,
        (job) =>
          task.setStatus(
            `Evaluation ${job.id}: ${job.state}. Partial results remain visible in run history.`,
          ),
      );
      if (!signal.aborted) showRun(receipt.runId);
    });
  }
  const counts = comparisonCounts(run.data?.results ?? []);
  const exhausted = usage.data
    ? usage.data.used.check + usage.data.reserved.check >=
      usage.data.limits.checks
    : false;
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="EVIDENCE BEFORE COMMITMENT"
        title="Compare. Check. Decide."
        description="Baseline and candidate answers, immutable expected facts, preliminary grading, and human verdicts."
      >
        {owner && (
          <Button onClick={() => setEditor("new")}>Add saved check</Button>
        )}
      </PageHeader>
      <p className="state-notice">
        Historical comparisons may favor candidates with newer knowledge. Dates,
        context, losses, failures, and ungraded cases remain visible. Automated
        grading is preliminary, not definitive accuracy.
      </p>
      <TaskNotice task={task} />
      <div className="panel stack-form">
        {owner && (
          <label className="field">
            Import CSV / JSON cases
            <input
              type="file"
              accept=".csv,.json"
              disabled={task.busy}
              onChange={(e) => {
                importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <small>
              Fields: question, expectedFacts, previousAnswer,
              conversationContext, category, importance, split,
              baselineTimestamp. CSV names/schema are described in
              docs/mvp-and-workflows.md and the backend API.
            </small>
          </label>
        )}
        <ErrorNotice error={releases.error} retry={releases.reload} />
        <label className="field">
          Candidate release
          <select
            value={releaseChoice}
            onChange={(e) => setReleaseChoice(e.target.value)}
          >
            <option value="">Choose an immutable snapshot…</option>
            {releases.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} · revision {r.draftRevision} · {r.id}
              </option>
            ))}
          </select>
        </label>
        <ErrorNotice error={usage.error} retry={usage.reload} />
        {exhausted && (
          <p role="alert" className="state-notice state-error">
            Check allowance exhausted. No silent extra purchases or skipped
            checks. Review partial runs or manage billing.
          </p>
        )}
        {usage.data && (
          <p>
            {usage.data.used.check} used + {usage.data.reserved.check} reserved
            / {usage.data.limits.checks} checks.
          </p>
        )}
        <Button
          disabled={
            task.busy || !owner || exhausted || !releaseChoice || !usage.data
          }
          onClick={evaluate}
        >
          Run {selected.length ? `${selected.length} selected` : "all saved"}{" "}
          checks (uses allowance)
        </Button>
      </div>
      <div className="split-panels">
        <section className="panel">
          <h2>Saved cases</h2>
          <ErrorNotice error={cases.error} retry={cases.reload} />
          {cases.loading && !cases.data && <Loading />}
          {cases.data?.items.map((c) => (
            <article className="data-row" key={c.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, c.id]
                        : ids.filter((id) => id !== c.id),
                    )
                  }
                />{" "}
                {c.question}
              </label>
              <Badge>
                {c.importance} · {c.split}
                {c.frozen ? " · frozen" : ""}
              </Badge>
              <ul>
                {c.expectedFacts.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
              <Button variant="secondary" onClick={() => setEditor(c)}>
                Inspect / edit expected facts
              </Button>
            </article>
          ))}
          {cases.data?.items.length === 0 && (
            <Empty
              title="No checks yet."
              description="Import cases or explicitly save an owner-approved regression check."
            />
          )}
          <div className="inline-actions">
            {cursor && (
              <Button
                variant="secondary"
                onClick={() => {
                  setCursor(undefined);
                  setSelected([]);
                }}
              >
                First cases page
              </Button>
            )}
            {cases.data?.nextCursor && (
              <Button
                variant="secondary"
                onClick={() => {
                  setCursor(cases.data!.nextCursor!);
                  setSelected([]);
                }}
              >
                Next cases page
              </Button>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Run history</h2>
          <ErrorNotice error={runs.error} retry={runs.reload} />
          {runs.loading && !runs.data && <Loading />}
          {runs.data?.items.map((r) => (
            <button
              className="data-row"
              key={r.id}
              onClick={() => showRun(r.id)}
            >
              <strong>{r.id}</strong>
              <Badge
                tone={
                  r.state === "failed"
                    ? "red"
                    : r.state === "succeeded"
                      ? "green"
                      : "amber"
                }
              >
                {r.state}
              </Badge>
              <small>
                {formatDate(r.createdAt)} · release {r.releaseId}
              </small>
            </button>
          ))}
          {runs.data?.items.length === 0 && <p>No evaluation runs.</p>}
          <div className="inline-actions">
            <Button variant="secondary" onClick={runs.reload}>
              Refresh run history
            </Button>
            {runCursor && (
              <Button
                variant="secondary"
                onClick={() => setRunCursor(undefined)}
              >
                First runs page
              </Button>
            )}
            {runs.data?.nextCursor && (
              <Button
                variant="secondary"
                onClick={() => setRunCursor(runs.data!.nextCursor!)}
              >
                Next runs page
              </Button>
            )}
          </div>
        </section>
      </div>
      <ErrorNotice error={run.error} retry={run.reload} />
      {runId && run.loading && !run.data && <Loading />}
      {run.data && (
        <section className="panel">
          <h2>Run review · {run.data.run.state}</h2>
          <p>
            {run.data.run.id} · candidate release {run.data.run.releaseId}
          </p>
          {run.data.run.limitations.map((limitation, i) => (
            <p className="state-notice" key={i}>
              {limitation}
            </p>
          ))}
          <div className="result-counts">
            <Badge tone="green">{counts.wins} wins</Badge>
            <Badge tone="red">{counts.losses} losses</Badge>
            <Badge>{counts.ties} ties</Badge>
            <Badge tone="red">{counts.failures} failures</Badge>
            <Badge tone="amber">{counts.ungraded} ungraded</Badge>
          </div>
          {run.data.run.state !== "succeeded" && (
            <p role="status" className="state-notice">
              Run is {run.data.run.state}. These results may be partial or
              interrupted; missing cases have not passed.
            </p>
          )}
          {run.data.results.map((result) => (
            <article className="evaluation-result" key={result.id}>
              <h3>{result.caseSnapshot.question}</h3>
              <p>
                Baseline timestamp:{" "}
                {formatDate(result.caseSnapshot.baselineTimestamp)} ·{" "}
                {result.caseSnapshot.importance} · {result.caseSnapshot.split}
              </p>
              <p>
                Context:{" "}
                {result.caseSnapshot.conversationContext || "Not supplied"}
              </p>
              <div className="side-by-side">
                <div>
                  <h4>Baseline answer</h4>
                  <p className="source-text">
                    {result.caseSnapshot.previousAnswer ||
                      "No baseline supplied"}
                  </p>
                </div>
                <div>
                  <h4>Candidate answer</h4>
                  <p className="source-text">
                    {result.answer?.content ?? "No completed answer"}
                  </p>
                  <EvidenceList evidence={result.answer?.evidence ?? []} />
                </div>
              </div>
              <h4>Expected facts — immutable run snapshot</h4>
              <ul>
                {result.caseSnapshot.expectedFacts.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
              <p>
                Missing facts:{" "}
                {result.deterministic.missingFacts.join("; ") ||
                  "None reported"}{" "}
                · eligible citations:{" "}
                {String(result.deterministic.eligibleCitations)}
              </p>
              {result.error && (
                <p className="state-notice state-error" role="alert">
                  Case failed: {result.error}
                </p>
              )}
              <details>
                <summary>
                  Preliminary automated grade — requires human review
                </summary>
                <pre>{JSON.stringify(result.preliminaryGrade, null, 2)}</pre>
              </details>
              <label className="field">
                Human verdict
                <select
                  disabled={task.busy || !owner || !!result.error}
                  value={result.humanVerdict ?? ""}
                  onChange={(e) => {
                    const verdict = e.target.value as HumanVerdict;
                    task.run(async (signal) => {
                      await api.verdict(w, result.id, verdict, signal);
                      if (!signal.aborted)
                        task.setStatus(
                          "Human verdict saved. Expected facts and historical answers are unchanged.",
                        );
                    });
                  }}
                >
                  <option value="" disabled>
                    Unreviewed
                  </option>
                  <option value="candidate_better">Candidate better</option>
                  <option value="baseline_better">Baseline better</option>
                  <option value="tie">Tie</option>
                  <option value="ungradable">Ungradable</option>
                </select>
              </label>
            </article>
          ))}
        </section>
      )}
      {editor && (
        <EvaluationEditor
          key={editor === "new" ? "new" : editor.id}
          existing={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
