"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Authority, SourceDetail, SourceKind } from "@/contracts/api";
import { useWorkspace } from "@/lib/store";
import { useResource, useTask } from "@/lib/resources";
import {
  downloadBlob,
  formatDate,
  safeUrl,
  validateSourceEdit,
} from "@/lib/presentation";
import { Badge, Button, Modal } from "./ui";
import { ErrorNotice, Loading, TaskNotice } from "./async-state";
export function ImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { api, workspaceId: w, owner } = useWorkspace();
  const [tab, setTab] = useState<"website" | "upload" | "approved_answer">(
    "website",
  );
  const [title, setTitle] = useState(""),
    [url, setUrl] = useState(""),
    [content, setContent] = useState("");
  const [kind, setKind] = useState<SourceKind>("website"),
    [authority, setAuthority] = useState<Authority>("reference"),
    [approval, setApproval] = useState(true),
    [file, setFile] = useState<File | null>(null);
  const task = useTask(`${w}:${open}:${tab}`);
  useEffect(() => {
    if (!open) {
      setTitle("");
      setUrl("");
      setContent("");
      setFile(null);
    }
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!owner) return;
    if (!title.trim()) {
      task.setError(new Error("Add a non-empty title."));
      return;
    }
    if (tab === "approved_answer" && validateSourceEdit(title, content)) {
      task.setError(new Error(validateSourceEdit(title, content)!));
      return;
    }
    if (tab === "website" && !safeUrl(url.trim())) {
      task.setError(
        new Error("Use a complete public http(s) website or sitemap URL."),
      );
      return;
    }
    await task.run(async (signal) => {
      let accepted;
      if (tab === "upload") {
        if (!file)
          throw new Error(
            "Choose a PDF, TXT, Markdown, Q&A CSV, or Q&A XLSX file.",
          );
        const map: Record<string, SourceKind> = {
          pdf: "pdf",
          txt: "text",
          md: "markdown",
          csv: "qa_csv",
          xlsx: "qa_xlsx",
        };
        const fileKind = map[file.name.split(".").pop()!.toLowerCase()];
        if (!fileKind) throw new Error("Unsupported file type.");
        const data = new FormData();
        data.set("file", file);
        data.set("title", title.trim());
        data.set("kind", fileKind);
        data.set("authority", authority);
        data.set("approvalRequired", String(approval));
        accepted = await api.upload(w, data, signal);
      } else
        accepted = await api.createSource(
          w,
          {
            title: title.trim(),
            kind: tab === "website" ? kind : "approved_answer",
            authority,
            approvalRequired: approval,
            ...(tab === "website"
              ? { url: url.trim() }
              : { content: content.trim() }),
          },
          signal,
        );
      if (signal.aborted) return;
      task.setStatus(
        `Import accepted, job ${accepted.jobId}. Not yet ready or published.`,
      );
      const result = await api.waitForJob<SourceDetail>(
        w,
        accepted.jobId,
        signal,
        (job) => task.setStatus(`Job ${job.id}: ${job.state}`),
      );
      if (!signal.aborted)
        task.setStatus(
          `Processing finished: ${result.source.processingState}. ${result.source.warnings.join(" ")} Inspect the source before publishing.`,
        );
    });
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Give your agent some knowledge."
      wide
    >
      <div className="import-tabs">
        {(["website", "upload", "approved_answer"] as const).map((value) => (
          <button
            key={value}
            onClick={() => {
              setTab(value);
              task.setError(null);
            }}
            className={tab === value ? "selected" : ""}
          >
            {value === "website"
              ? "Website / sitemap"
              : value === "upload"
                ? "Upload file"
                : "Approved answer"}
          </button>
        ))}
      </div>
      <form className="import-form" onSubmit={submit}>
        <p>
          Files and URLs are processed by the backend. Partial extraction and
          failures are not treated as ready knowledge.
        </p>
        <label className="field">
          Source title
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {tab === "website" && (
          <>
            <label className="field">
              Import type
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as SourceKind)}
              >
                <option value="website">Website</option>
                <option value="sitemap">Sitemap</option>
              </select>
            </label>
            <label className="field">
              Website URL
              <input
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://help.yourcompany.com"
              />
            </label>
          </>
        )}
        {tab === "upload" && (
          <label className="field">
            Source file
            <input
              type="file"
              required
              accept=".pdf,.txt,.md,.csv,.xlsx"
              onChange={(e) => {
                if (task.busy) task.cancel();
                setFile(e.target.files?.[0] ?? null);
              }}
            />
            <small>
              PDF, TXT, Markdown, Q&A CSV or XLSX. Server-enforced
              size/allowance limits apply.
            </small>
          </label>
        )}
        {tab === "approved_answer" && (
          <label className="field">
            Approved customer-facing content
            <textarea
              required
              maxLength={1000000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          Authority
          <select
            value={authority}
            onChange={(e) => setAuthority(e.target.value as Authority)}
          >
            <option value="reference">Reference</option>
            <option value="authoritative">Authoritative</option>
            <option value="approved">Approved</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={approval}
            onChange={(e) => setApproval(e.target.checked)}
          />{" "}
          Require owner approval
        </label>
        <TaskNotice task={task} />
        <div className="form-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button disabled={task.busy || !owner}>Submit for processing</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SourceInspector({
  id,
  versionId,
  onClose,
}: {
  id: string | null;
  versionId?: string | null;
  onClose: () => void;
}) {
  const { api, workspaceId: w, owner } = useWorkspace();
  const source = useResource(
    api,
    id ? `/workspaces/${w}/sources/${id}` : null,
    (s) => api.source(w, id!, s),
  );
  const task = useTask(`${w}:${id}`);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(
      versionId ?? null,
    ),
    [confirm, setConfirm] = useState(false),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(""),
    [content, setContent] = useState("");
  useEffect(() => {
    setSelectedVersion(versionId ?? null);
    setConfirm(false);
    setEditing(false);
  }, [id, versionId]);
  const detail = source.data;
  const version = detail?.versions.find(
    (v) => v.id === (selectedVersion ?? detail.source.draftVersionId),
  );
  async function action(value: "archive" | "restore" | "delete" | "reprocess") {
    if (!id) return;
    await task.run(async (signal) => {
      if (value === "delete") {
        await api.deleteSource(w, id, signal);
        if (!signal.aborted) {
          task.setStatus(
            "Source permanently revoked. Rollback cannot recover deleted knowledge.",
          );
          setConfirm(false);
        }
      } else if (value === "reprocess") {
        const accepted = await api.reprocess(w, id, signal);
        task.setStatus(`Reprocessing accepted: ${accepted.jobId}`);
        await api.waitForJob(w, accepted.jobId, signal, (job) =>
          task.setStatus(`Job ${job.id}: ${job.state}`),
        );
      } else {
         const current = (await api.source(w, id, signal)).source;
         await api.updateSource(w, id, { action: value, expectedRevision: current.revision }, signal);
        if (!signal.aborted)
          task.setStatus(`Backend receipt received: ${value}.`);
      }
      source.reload();
    });
  }
  return (
    <Modal open={!!id} onClose={onClose} title="Source inspection" wide>
      <div className="import-form">
        <TaskNotice task={task} />
        <ErrorNotice error={source.error} retry={source.reload} />
        {source.loading && <Loading />}
        {detail && (
          <>
            <h3>{detail.source.title}</h3>
            <div className="inline-actions">
              <Badge>{detail.source.status}</Badge>
              <Badge
                tone={
                  detail.source.processingState === "failed"
                    ? "red"
                    : detail.source.processingState === "ready"
                      ? "green"
                      : "amber"
                }
              >
                {detail.source.processingState}
              </Badge>
              {detail.source.held && (
                <Badge tone="red">Withheld from answers</Badge>
              )}
            </div>
            <p>
              Authority: {detail.source.authority} ·{" "}
              {detail.source.approvalRequired
                ? "Approval required"
                : "Ordinary review"}
            </p>
            <p>
              Created {formatDate(detail.source.createdAt)} · last checked{" "}
              {formatDate(detail.source.lastCheckedAt)}
            </p>
            {safeUrl(detail.source.url) && (
              <a
                className="subtle-link"
                href={safeUrl(detail.source.url)!}
                target="_blank"
                rel="noopener noreferrer"
              >
                Original website
              </a>
            )}
            {detail.source.warnings.map((warning, i) => (
              <p key={i} role="status" className="state-notice">
                {warning}
              </p>
            ))}
            <dl className="metadata-list">
              <dt>Draft version</dt>
              <dd>{detail.source.draftVersionId ?? "Not extracted"}</dd>
              <dt>Published version</dt>
              <dd>{detail.source.publishedVersionId ?? "Not published"}</dd>
            </dl>
            <label className="field">
              Source version
              <select
                value={selectedVersion ?? detail.source.draftVersionId ?? ""}
                onChange={(e) => {
                  setSelectedVersion(e.target.value);
                  setEditing(false);
                }}
              >
                {versionId &&
                  !detail.versions.some((v) => v.id === versionId) && (
                    <option value={versionId}>{versionId} — unavailable</option>
                  )}
                {detail.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}{" "}
                    {v.id === detail.source.publishedVersionId
                      ? "(published)"
                      : v.id === detail.source.draftVersionId
                        ? "(draft)"
                        : "(historical)"}
                  </option>
                ))}
              </select>
            </label>
            {version ? (
              <>
                <p>
                  {version.pageCount} pages · extracted{" "}
                  {formatDate(version.createdAt)} · hash {version.contentHash}
                </p>
                {version.warnings.map((warning, i) => (
                  <p className="state-notice" key={i}>
                    {warning}
                  </p>
                ))}
                <pre className="source-text">
                  {version.content || "Content revoked / unavailable."}
                </pre>
                <ul>
                  {version.references.map((ref, i) => (
                    <li key={i}>
                      Page {ref.page ?? "—"} · section {ref.section ?? "—"}
                      {safeUrl(ref.url) && (
                        <a
                          className="subtle-link"
                          href={safeUrl(ref.url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {" "}
                          · source reference
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="state-notice">
                This exact version is not available in the returned history. No
                current draft has been substituted.
              </p>
            )}
            {owner && detail.source.status !== "deleted" && (
              <>
                <div className="inline-actions">
                  <Button
                    variant="secondary"
                    disabled={task.busy}
                    onClick={() => {
                      setEditing(!editing);
                      setTitle(detail.source.title);
                      setContent(version?.content ?? "");
                    }}
                  >
                    Edit / inspect correction
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={task.busy}
                    onClick={() =>
                      action(
                        detail.source.status === "archived"
                          ? "restore"
                          : "archive",
                      )
                    }
                  >
                    {detail.source.status === "archived"
                      ? "Restore source"
                      : "Archive source"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={task.busy}
                    onClick={() => action("reprocess")}
                  >
                    Reprocess original
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={task.busy}
                    onClick={() =>
                      task.run(async (signal) => {
                        const blob = await api.asset(w, id!, signal);
                        if (!signal.aborted) downloadBlob(`source-${id}`, blob);
                      })
                    }
                  >
                    Download original
                  </Button>
                  <Button
                    variant="danger"
                    disabled={task.busy}
                    onClick={() => setConfirm(true)}
                  >
                    Delete source
                  </Button>
                </div>
                {editing && (
                  <form
                    className="stack-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                       const validation = validateSourceEdit(title, content);
                       if (validation) { task.setError(new Error(validation)); return; }
                       task.run(async signal => {
                         await api.updateSource(w, id!, { title, content, expectedRevision: detail.source.revision }, signal);
                         if (!signal.aborted) { setEditing(false); source.reload(); task.setStatus('Correction staged for processing.'); }
                       });
                    }}
                  >
                    <label className="field">
                      Title
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={200}
                      />
                    </label>
                    <label className="field">
                      Source content
                      <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        maxLength={1000000}
                      />
                    </label>
                    <p className="state-notice">
                       Corrections use atomic expected revisions. Website/PDF source text is read-only; use a dependent approved-answer source for a customer-facing correction.
                    </p>
                     <Button variant="secondary">Validate correction</Button>
                  </form>
                )}
                {confirm && (
                  <section className="state-notice state-error">
                    <p>
                      Permanently delete this source and revoke it across all
                      releases? Rollback cannot restore it.
                    </p>
                    <Button
                      variant="danger"
                      disabled={task.busy}
                      onClick={() => action("delete")}
                    >
                      Confirm permanent deletion
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setConfirm(false)}
                    >
                      Keep source
                    </Button>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
