"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useWorkspace, useWorkspaceHref } from "@/lib/store";
import { useResource, useTask } from "@/lib/resources";
import { formatDate } from "@/lib/presentation";
import { Badge, Button, Empty, PageHeader, SourceIcon } from "../ui";
import { ErrorNotice, Loading, TaskNotice } from "../async-state";
import { ImportDialog, SourceInspector } from "../knowledge-tools";

export function Knowledge() {
  const { api, workspaceId: w, owner } = useWorkspace(),
    href = useWorkspaceHref();
  const params = useSearchParams(),
    router = useRouter();
  const [cursor, setCursor] = useState<string | undefined>();
  const sources = useResource(
    api,
    `/workspaces/${w}/sources?cursor=${cursor ?? ""}`,
    (s) => api.sources(w, s, cursor),
  );
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active"),
    [selected, setSelected] = useState<string[]>([]);
  const task = useTask(w);
  useEffect(() => {
    if (
      sources.data?.items.some((s) =>
        ["queued", "processing"].includes(s.processingState),
      )
    ) {
      const timer = setTimeout(sources.reload, 2000);
      return () => clearTimeout(timer);
    }
  }, [sources.data, sources.reload]);
  function query(values: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([k, v]) =>
      v === null ? next.delete(k) : next.set(k, v),
    );
    router.push(`/app/knowledge?${next}`, { scroll: false });
  }
  const visible =
    sources.data?.items.filter(
      (s) =>
        s.status !== "deleted" &&
        (filter === "all" || s.status === filter) &&
        `${s.title} ${s.url ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  async function archiveSelected() {
    await task.run(async (signal) => {
      for (const sourceId of selected) {
        const current = (await api.source(w, sourceId, signal)).source;
        await api.updateSource(w, sourceId, { action: "archive", expectedRevision: current.revision }, signal);
        if (signal.aborted) return;
      }
      setSelected([]);
      task.setStatus(
        "Selected sources archived by the backend. Review eligibility and release changes.",
      );
    });
  }
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="THE FOUNDATION OF EVERY ANSWER"
        title="What your business knows."
        description="Real sources. Visible extraction states. Draft changes stay separate from published versions."
      >
        {owner && (
          <Button onClick={() => query({ import: "1" })}>
            <Plus size={16} />
            Add source
          </Button>
        )}
      </PageHeader>
      <TaskNotice task={task} />
      <ErrorNotice error={sources.error} retry={sources.reload} />
      {sources.loading ? (
        <Loading />
      ) : (
        sources.data && (
          <>
            <div className="knowledge-summary">
              <div>
                <strong>{sources.data.items.length} loaded sources</strong>
              </div>
              <div>
                <strong>
                  {
                    sources.data.items.filter((s) => s.publishedVersionId)
                      .length
                  }{" "}
                  with a published version
                </strong>
              </div>
              <div>
                <strong>
                  {
                    sources.data.items.filter(
                      (s) => s.draftVersionId !== s.publishedVersionId,
                    ).length
                  }{" "}
                  changed version pointers
                </strong>
              </div>
            </div>
            <div className="table-toolbar">
              <label className="search-field">
                <Search size={16} />
                <input
                  aria-label="Find a source"
                  placeholder="Search loaded sources…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="field">
                Source status
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All retained sources</option>
                </select>
              </label>
              {owner && selected.length > 0 && (
                <Button
                  variant="secondary"
                  disabled={task.busy}
                  onClick={archiveSelected}
                >
                  Archive {selected.length} selected
                </Button>
              )}
            </div>
            <div className="source-table-wrap">
              <table className="source-table">
                <caption className="sr-only">
                  Knowledge sources and processing states
                </caption>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Source</th>
                    <th>Processing</th>
                    <th>Authority</th>
                    <th>Versions</th>
                    <th>Checked (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((source) => (
                    <tr key={source.id}>
                      <td>
                        {owner && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${source.title}`}
                            checked={selected.includes(source.id)}
                            onChange={(e) =>
                              setSelected((ids) =>
                                e.target.checked
                                  ? [...ids, source.id]
                                  : ids.filter((id) => id !== source.id),
                              )
                            }
                          />
                        )}
                      </td>
                      <td>
                        <button
                          className="source-name"
                          onClick={() =>
                            query({ source: source.id, version: null })
                          }
                        >
                          <SourceIcon kind={source.kind} />
                          <span>
                            <strong>{source.title}</strong>
                            <small>
                              {source.url || source.kind} · {source.status}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <Badge
                          tone={
                            source.processingState === "failed"
                              ? "red"
                              : source.processingState === "ready"
                                ? "green"
                                : "amber"
                          }
                        >
                          {source.processingState}
                        </Badge>
                        {source.held && <Badge tone="red">Withheld</Badge>}
                        {source.warnings.length > 0 && (
                          <small>
                            {source.warnings.length} warnings — inspect source
                          </small>
                        )}
                      </td>
                      <td>
                        {source.authority}
                        {source.approvalRequired && (
                          <small>Approval required</small>
                        )}
                      </td>
                      <td>
                        {source.draftVersionId === source.publishedVersionId &&
                        source.publishedVersionId
                          ? "Published version matches draft"
                          : "Draft differs / unpublished"}
                      </td>
                      <td>{formatDate(source.lastCheckedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 && (
                <Empty
                  title="No matching sources."
                  description="Add customer-facing knowledge, or change your search/status filter."
                />
              )}
            </div>
            <div className="inline-actions">
              {cursor && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCursor(undefined);
                    setSelected([]);
                  }}
                >
                  First page
                </Button>
              )}
              {sources.data.nextCursor && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCursor(sources.data!.nextCursor!);
                    setSelected([]);
                  }}
                >
                  Next 100 sources
                </Button>
              )}
              <Button variant="secondary" onClick={sources.reload}>
                Refresh processing states
              </Button>
            </div>
            <p className="table-footnote">
              Search and counts cover loaded sources, not a global total.
              Archive/revocation eligibility is enforced by the backend,
              including historical releases.
            </p>
            <a className="button button-secondary" href={href("/app/releases")}>
              Review draft & releases
            </a>
          </>
        )
      )}
      <ImportDialog
        open={params.get("import") === "1"}
        onClose={() => query({ import: null })}
      />
      <SourceInspector
        id={params.get("source")}
        versionId={params.get("version")}
        onClose={() => query({ source: null, version: null })}
      />
    </div>
  );
}
