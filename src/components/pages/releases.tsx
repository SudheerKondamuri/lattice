"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspace, useWorkspaceHref } from "@/lib/store";
import { useResource, useTask } from "@/lib/resources";
import { formatDate } from "@/lib/presentation";
import { Badge, Button, Empty, Modal, PageHeader } from "../ui";
import { ErrorNotice, Loading, TaskNotice } from "../async-state";
export function Releases() {
  const { api, workspaceId: w, detail, owner } = useWorkspace(),
    href = useWorkspaceHref(),
    params = useSearchParams(),
    router = useRouter();
  const [label, setLabel] = useState(""),
    [cursor, setCursor] = useState<string | undefined>(),
    [acknowledge, setAcknowledge] = useState(false),
    [confirmation, setConfirmation] = useState<{
      releaseId: string;
      rollback: boolean;
      expected: string | null;
    } | null>(null);
  const list = useResource(
    api,
    `/workspaces/${w}/releases?cursor=${cursor ?? ""}`,
    (s) => api.releases(w, s, cursor),
  );
  const id = params.get("release") ?? list.data?.items[0]?.id ?? null;
  const release = useResource(
    api,
    id ? `/workspaces/${w}/releases/${id}` : null,
    (s) => api.release(w, id!, s),
  );
  const checks = useResource(
    api,
    id ? `/workspaces/${w}/releases/${id}/checks` : null,
    (s) => api.releaseChecks(w, id!, s),
  );
  const publishedId = detail?.agent.publishedReleaseId;
  const published = useResource(
    api,
    publishedId ? `/workspaces/${w}/releases/${publishedId}` : null,
    (s) => api.release(w, publishedId!, s),
  );
  const sources = useResource(api, `/workspaces/${w}/sources`, (s) =>
    api.sources(w, s),
  );
  const task = useTask(w);
  function select(value: string) {
    const next = new URLSearchParams(params);
    next.set("release", value);
    router.push(`/app/releases?${next}`, { scroll: false });
  }
  async function snapshot(e: FormEvent) {
    e.preventDefault();
    await task.run(async (signal) => {
      if (!label.trim()) throw new Error("Provide a meaningful release label.");
      const result = await api.snapshot(w, label.trim(), signal);
      if (!signal.aborted) {
        select(result.id);
        setLabel("");
        task.setStatus(
          `Immutable draft snapshot ${result.id} created. Not yet published.`,
        );
      }
    });
  }
  async function publish() {
    if (!confirmation) return;
    await task.run(async (signal) => {
      const agent = await api.publish(
        w,
        confirmation.releaseId,
        {
          expectedPublishedReleaseId: confirmation.expected,
          acknowledgeWarnings: acknowledge,
        },
        confirmation.rollback,
        signal,
      );
      if (!signal.aborted) {
        setConfirmation(null);
        task.setStatus(
          `Backend confirmed ${confirmation.rollback ? "rollback" : "publication"}: ${agent.publishedReleaseId}. Deleted/revoked sources remain ineligible.`,
        );
      }
    });
  }
  const added =
    release.data?.sourceVersionIds.filter(
      (v) => !published.data?.sourceVersionIds.includes(v),
    ) ?? [];
  const removed =
    published.data?.sourceVersionIds.filter(
      (v) => !release.data?.sourceVersionIds.includes(v),
    ) ?? [];
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="DRAFT. CHECK. REVIEW. PUBLISH."
        title="Make the next answer better."
        description="Immutable backend-issued releases, explicit check review, atomic publication, and honest rollback."
      />
      <TaskNotice task={task} />
      {owner && (
        <form className="panel stack-form" onSubmit={snapshot}>
          <label className="field">
            Release label
            <input
              required
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Describe the knowledge/configuration change"
            />
          </label>
          <p>
            Draft revision {detail?.agent.draftRevision}. Snapshot freezes the
            backend draft; it does not publish it.
          </p>
          <Button disabled={task.busy}>Create draft snapshot</Button>
        </form>
      )}
      <div className="split-panels">
        <section className="panel">
          <h2>Release history</h2>
          <ErrorNotice error={list.error} retry={list.reload} />
          {list.loading && !list.data && <Loading />}
          {list.data?.items.map((r) => (
            <button
              className="data-row"
              key={r.id}
              onClick={() => select(r.id)}
            >
              <strong>{r.label}</strong>
              <Badge tone={r.id === publishedId ? "green" : "neutral"}>
                {r.id === publishedId
                  ? "Current published"
                  : r.publishedAt
                    ? "Previously published"
                    : "Draft snapshot"}
              </Badge>
              <small>
                Backend ID {r.id} · revision {r.draftRevision} ·{" "}
                {formatDate(r.createdAt)}
              </small>
            </button>
          ))}
          {list.data?.items.length === 0 && (
            <Empty
              title="No releases yet."
              description="Finish source processing, then create a draft snapshot and run checks."
            />
          )}
          <div className="inline-actions">
            {cursor && (
              <Button variant="secondary" onClick={() => setCursor(undefined)}>
                First page
              </Button>
            )}
            {list.data?.nextCursor && (
              <Button
                variant="secondary"
                onClick={() => setCursor(list.data!.nextCursor!)}
              >
                Next page
              </Button>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Draft changes & source readiness</h2>
          <ErrorNotice error={sources.error} retry={sources.reload} />
          {sources.loading && !sources.data && <Loading />}
          {sources.data?.items
            .filter(
              (s) =>
                s.draftVersionId !== s.publishedVersionId ||
                s.status !== "active" ||
                s.held ||
                s.processingState !== "ready",
            )
            .map((s) => (
              <Link
                className="data-row"
                href={href(`/app/knowledge?source=${s.id}`)}
                key={s.id}
              >
                <strong>{s.title}</strong>
                <Badge
                  tone={
                    s.processingState === "failed" || s.held ? "red" : "amber"
                  }
                >
                  {s.status} · {s.processingState}
                </Badge>
                <small>
                  Draft {s.draftVersionId ?? "none"} · published{" "}
                  {s.publishedVersionId ?? "none"}
                </small>
              </Link>
            ))}
          <p>
            Readiness and differences cover the loaded source page.
            Release-check warnings are backend-authoritative.
          </p>
        </section>
      </div>
      <ErrorNotice error={release.error} retry={release.reload} />
      {id && release.loading && !release.data && <Loading />}
      {release.data && (
        <section className="panel">
          <h2>{release.data.label}</h2>
          <p className="break-anywhere">
            Release {release.data.id} · draft revision{" "}
            {release.data.draftRevision}
          </p>
          <h3>Exact version-list differences from current publication</h3>
          <ErrorNotice error={published.error} retry={published.reload} />
          {publishedId && !published.data ? (
            <Loading label="Loading published snapshot for differences…" />
          ) : (
            <div className="side-by-side">
              <div>
                <h4>Added / changed version IDs ({added.length})</h4>
                <ul>
                  {added.map((v) => (
                    <li className="break-anywhere" key={v}>
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Removed / replaced version IDs ({removed.length})</h4>
                <ul>
                  {removed.map((v) => (
                    <li className="break-anywhere" key={v}>
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <details>
            <summary>
              Immutable agent configuration (compared with current publication)
            </summary>
            <div className="side-by-side">
              <pre>
                {JSON.stringify(published.data?.config ?? null, null, 2)}
              </pre>
              <pre>{JSON.stringify(release.data.config, null, 2)}</pre>
            </div>
          </details>
          <ErrorNotice error={checks.error} retry={checks.reload} />
          {checks.loading && !checks.data && (
            <Loading label="Loading release checks…" />
          )}
          {checks.data && (
            <>
              <h3>Check review</h3>
              <p>
                {checks.data.failures} failures · {checks.data.regressions}{" "}
                regressions · {checks.data.unreviewed} unreviewed ·{" "}
                {checks.data.criticalUnreviewed} critical unreviewed.
              </p>
              {checks.data.warnings.map((warning, i) => (
                <p className="state-notice" key={i}>
                  {warning}
                </p>
              ))}
              {checks.data.latestRunId && (
                <Link
                  className="button button-secondary"
                  href={href(`/app/compare?run=${checks.data.latestRunId}`)}
                >
                  Inspect latest results
                </Link>
              )}
              <Link
                className="button button-secondary"
                href={href(`/app/compare?release=${release.data.id}`)}
              >
                Run checks for this snapshot
              </Link>
              {owner && (
                <div className="inline-actions">
                  <Button
                    disabled={task.busy || release.data.id === publishedId}
                    onClick={() => {
                      setAcknowledge(false);
                      setConfirmation({
                        releaseId: release.data!.id,
                        rollback: false,
                        expected: publishedId ?? null,
                      });
                    }}
                  >
                    Review publication
                  </Button>
                  {release.data.publishedAt &&
                    release.data.id !== publishedId && (
                      <Button
                        variant="secondary"
                        disabled={task.busy}
                        onClick={() => {
                          setAcknowledge(false);
                          setConfirmation({
                            releaseId: release.data!.id,
                            rollback: true,
                            expected: publishedId ?? null,
                          });
                        }}
                      >
                        Review rollback
                      </Button>
                    )}
                </div>
              )}
            </>
          )}
        </section>
      )}
      <Modal
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        title={
          confirmation?.rollback ? "Confirm rollback" : "Confirm publication"
        }
      >
        <div className="import-form">
          <p>
            Switch the public release pointer to {confirmation?.releaseId}? New
            visitor turns will use this release. Historical evidence will keep
            its original version.
          </p>
          <p className="state-notice">
            Rollback cannot restore deleted or revoked knowledge. Source
            eligibility is enforced across every release.
          </p>
          <p>
            {checks.data?.failures ?? "—"} failures ·{" "}
            {checks.data?.regressions ?? "—"} regressions ·{" "}
            {checks.data?.unreviewed ?? "—"} unreviewed cases.
          </p>
          {checks.data?.warnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
          {(checks.data?.warnings.length ?? 0) > 0 && (
            <label>
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />{" "}
              I reviewed and explicitly acknowledge all visible
              failing/unreviewed check warnings.
            </label>
          )}
          <TaskNotice task={task} />
          <Button
            disabled={
              task.busy ||
              !checks.data ||
              (checks.data.warnings.length > 0 && !acknowledge)
            }
            onClick={publish}
          >
            Confirm {confirmation?.rollback ? "rollback" : "publication"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmation(null)}>
            Keep current publication
          </Button>
        </div>
      </Modal>
    </div>
  );
}
