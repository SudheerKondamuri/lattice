"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Escalation, Message } from "@/contracts/api";
import { useWorkspace } from "@/lib/store";
import { useResource, useTask } from "@/lib/resources";
import { downloadJson, formatDate } from "@/lib/presentation";
import { Badge, Button, Empty, PageHeader } from "../ui";
import { ErrorNotice, Loading, TaskNotice } from "../async-state";
import { Transcript } from "../transcript";
import { SourceInspector } from "../knowledge-tools";
import { CorrectionDialog } from "../correction-dialog";
export function Conversations() {
  const { api, workspaceId: w, owner } = useWorkspace(),
    params = useSearchParams(),
    router = useRouter();
  const id = params.get("id");
  const [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | undefined>(),
    [email, setEmail] = useState(""),
    [deleteConfirm, setDeleteConfirm] = useState(false);
  const [inspect, setInspect] = useState<{
      id: string;
      version: string;
    } | null>(null),
    [correction, setCorrection] = useState<{
      question: string;
      message: Message;
    } | null>(null);
  const list = useResource(
    api,
    `/workspaces/${w}/conversations?q=${search}&cursor=${cursor ?? ""}`,
    (s) => api.conversations(w, s, cursor, search),
  );
  const transcript = useResource(
    api,
    id ? `/workspaces/${w}/conversations/${id}` : null,
    (s) => api.conversation(w, id!, s),
  );
  const task = useTask(`${w}:${id}`);
  useEffect(() => {
    if (transcript.data?.escalations.some((e) => e.status === "pending")) {
      const timer = setTimeout(transcript.reload, 2000);
      return () => clearTimeout(timer);
    }
  }, [transcript.data, transcript.reload]);
  function select(value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set("id", value);
    else next.delete("id");
    setDeleteConfirm(false);
    router.push(`/app/conversations?${next}`, { scroll: false });
  }
  async function handoff(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    await task.run(async (signal) => {
      const accepted = await api.handoff(
        w,
        id,
        { email: email.trim() },
        signal,
      );
      task.setStatus(
        `Escalation ${accepted.escalationId}: queued, not sent. Job ${accepted.jobId}.`,
      );
      const delivered = await api.waitForJob<Escalation>(
        w,
        accepted.jobId,
        signal,
        (job) => task.setStatus(`Email job ${job.id}: ${job.state}`),
      );
      if (!signal.aborted)
        task.setStatus(
          `Escalation delivery: ${delivered.status}. The team replies by email.`,
        );
      transcript.reload();
    });
  }
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="LISTEN. INSPECT. IMPROVE."
        title="The conversations behind the answers."
        description="Actual transcripts, immutable evidence, feedback, and email-delivery receipts."
      />
      <div className="split-panels">
        <section className="panel">
          <h2>Saved conversations</h2>
          <label className="field">
            Search conversations
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(undefined);
              }}
              maxLength={200}
              placeholder="Search transcript text…"
            />
          </label>
          <ErrorNotice error={list.error} retry={list.reload} />
          {list.loading && <Loading />}
          {list.data?.items.map((c) => (
            <button
              className={`data-row ${id === c.id ? "is-selected" : ""}`}
              key={c.id}
              onClick={() => select(c.id)}
            >
              <strong className="break-anywhere">{c.id}</strong>
              <Badge>{c.mode}</Badge>
              <small>{formatDate(c.updatedAt)} UTC</small>
            </button>
          ))}
          {list.data?.items.length === 0 && (
            <Empty
              title="No conversations found."
              description="Questions appear here after backend processing."
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
          <h2>Transcript inspection</h2>
          <TaskNotice task={task} />
          {!id && (
            <Empty
              title="Choose a conversation."
              description="Inspect the exact evidence before making a correction."
            />
          )}
          <ErrorNotice error={transcript.error} retry={transcript.reload} />
          {id && transcript.loading && !transcript.data && (
            <Loading label="Loading transcript…" />
          )}
          {transcript.data && (
            <>
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  onClick={() =>
                    downloadJson(`conversation-${id}.json`, transcript.data)
                  }
                >
                  Export saved transcript
                </Button>
                <Button variant="secondary" onClick={transcript.reload}>
                  Refresh transcript
                </Button>
                {owner && (
                  <Button
                    variant="danger"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    Delete conversation
                  </Button>
                )}
              </div>
              {deleteConfirm && (
                <div className="state-notice state-error">
                  <p>Erase this transcript and revoke its visitor session?</p>
                  <Button
                    variant="danger"
                    disabled={task.busy}
                    onClick={() =>
                      task.run(async (signal) => {
                        await api.deleteConversation(w, id!, signal);
                        if (!signal.aborted) select(null);
                      })
                    }
                  >
                    Confirm transcript deletion
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setDeleteConfirm(false)}
                  >
                    Keep transcript
                  </Button>
                </div>
              )}
              <Transcript
                messages={transcript.data.messages}
                busy={task.busy}
                inspect={(id, version) => setInspect({ id, version })}
                feedback={(m, rating) =>
                  task.run(async (signal) => {
                    await api.feedback(
                      w,
                      id!,
                      { messageId: m.id, rating },
                      signal,
                    );
                    if (!signal.aborted)
                      task.setStatus("Feedback recorded by the backend.");
                  })
                }
                improve={(question, message) =>
                  setCorrection({ question, message })
                }
              />
              <h3>Email handoffs</h3>
              {transcript.data.escalations.length === 0 && (
                <p>No handoff requested.</p>
              )}
              {transcript.data.escalations.map((escalation) => (
                <div key={escalation.id} className="state-notice">
                  <Badge
                    tone={
                      escalation.status === "sent"
                        ? "green"
                        : escalation.status === "failed"
                          ? "red"
                          : "amber"
                    }
                  >
                    {escalation.status === "pending"
                      ? "Queued / pending delivery"
                      : escalation.status}
                  </Badge>
                  <p>
                    {escalation.email} · attempts {escalation.attempts}
                  </p>
                  {escalation.lastError && <p>{escalation.lastError}</p>}
                  {escalation.status === "failed" && (
                    <Button
                      disabled={task.busy}
                      variant="secondary"
                      onClick={() =>
                        task.run(async (signal) => {
                          const accepted = await api.retryEscalation(
                            w,
                            escalation.id,
                            signal,
                          );
                          task.setStatus(
                            `Retry queued: ${accepted.jobId}. Delivery not yet confirmed.`,
                          );
                          const result = await api.waitForJob<Escalation>(
                            w,
                            accepted.jobId,
                            signal,
                          );
                          if (!signal.aborted)
                            task.setStatus(`Escalation ${result.status}`);
                          transcript.reload();
                        })
                      }
                    >
                      Retry failed delivery
                    </Button>
                  )}
                </div>
              ))}
              <form className="stack-form" onSubmit={handoff}>
                <label className="field">
                  Customer email for handoff
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <p>
                  The team will reply by email. This submits the saved
                  transcript; queue acceptance is not delivery.
                </p>
                <Button disabled={task.busy}>Request email handoff</Button>
              </form>
            </>
          )}
        </section>
      </div>
      <SourceInspector
        id={inspect?.id ?? null}
        versionId={inspect?.version}
        onClose={() => setInspect(null)}
      />
      {correction && (
        <CorrectionDialog
          key={correction.message.id}
          {...correction}
          onClose={() => setCorrection(null)}
        />
      )}
    </div>
  );
}
