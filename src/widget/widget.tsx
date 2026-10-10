"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Answer, Escalation, WidgetSession } from "@/contracts/api";
import { ApiClient, ApiFailure } from "@/lib/api";
import { useResource, useTask } from "@/lib/resources";
import { downloadBlob, safeUrl } from "@/lib/presentation";
import {
  readVisitor,
  saveVisitor,
  readPending,
  savePending,
  clearPending,
  type PendingVisitorJob,
} from "./storage";
import { Button } from "@/components/ui";
import { ErrorNotice, Loading, TaskNotice } from "@/components/async-state";
import { Transcript } from "@/components/transcript";

export function Widget({ agentId, site }: { agentId: string; site: string }) {
  const [session, setSession] = useState<WidgetSession | null>(null),
    [trustedSite, setTrustedSite] = useState(false),
    [ready, setReady] = useState(false),
    [storageWarning, setStorageWarning] = useState(""),
    [framed, setFramed] = useState(false);
  const [question, setQuestion] = useState(""),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [handoffText, setHandoffText] = useState(""),
    [pending, setPending] = useState("");
  const [pendingJob, setPendingJob] = useState<PendingVisitorJob | null>(null);
  const sessionRef = useRef<WidgetSession | null>(session);
  sessionRef.current = session;
  const api = useMemo(
    () =>
      new ApiClient(async () => sessionRef.current?.token ?? null, fetch, site),
    [site],
  );
  const task = useTask(`${agentId}:${site}`);
  const transcript = useResource(
    api,
    session && ready && trustedSite
      ? `/public/conversation?session=${session.sessionId}`
      : null,
    (s) => api.widgetConversation(s),
  );
  useEffect(() => {
    setFramed(window.parent !== window);
    let valid = false;
    try {
      const url = new URL(site);
      valid =
        ["http:", "https:"].includes(url.protocol) &&
        url.origin === site &&
        /^[a-zA-Z0-9-]{8,100}$/.test(agentId);
    } catch {
      /* Invalid installation parameters stay unavailable. */
    }
    if (!valid) {
      task.setError(new Error("Invalid widget agent or site origin."));
      setReady(true);
      return;
    }
    const saved = readVisitor(agentId, site);
    setSession(saved);
    if (saved) setPendingJob(readPending(agentId, site, saved.sessionId));
    setReady(true);
    if (window.parent === window) {
      setTrustedSite(site === location.origin);
      return;
    }
    if (document.referrer) {
      try {
        if (new URL(document.referrer).origin === site) setTrustedSite(true);
      } catch {
        /* Require the origin-checked parent handshake below. */
      }
    }
    function receive(event: MessageEvent) {
      if (
        event.source === window.parent &&
        event.origin === site &&
        event.data?.type === "lattice:site" &&
        event.data.site === site
      )
        setTrustedSite(true);
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "lattice:ready" }, site);
    return () => window.removeEventListener("message", receive);
  }, [agentId, site]);
  async function observePending(job: PendingVisitorJob, signal: AbortSignal) {
    task.setStatus(
      `Resuming status observation of ${job.kind} job ${job.jobId}; the request is not being repeated.`,
    );
    try {
      await api.waitForJob<Answer | Escalation>(
        null,
        job.jobId,
        signal,
        (state) =>
          task.setStatus(`${job.kind} job ${state.id}: ${state.state}`),
      );
      if (!signal.aborted) {
        clearPending(agentId, site);
        setPendingJob(null);
        setPending("");
        transcript.reload();
        task.setStatus(
          "Accepted operation completed. The saved transcript and delivery status have been refreshed.",
        );
      }
    } catch (error) {
      if (
        error instanceof ApiFailure &&
        error.status === 422 &&
        !signal.aborted
      ) {
        clearPending(agentId, site);
        setPendingJob(null);
        transcript.reload();
      }
      throw error;
    }
  }
  async function start() {
    await task.run(async (signal) => {
      if (!trustedSite)
        throw new Error(
          "The widget could not confirm its installing page origin.",
        );
      const created = await api.widgetSession(agentId, signal);
      if (signal.aborted) return;
      setSession(created);
      clearPending(agentId, site);
      setPendingJob(null);
      sessionRef.current = created;
      if (!saveVisitor(agentId, site, created))
        setStorageWarning(
          "Browser storage is unavailable. This conversation will continue only while this page remains open.",
        );
      task.setStatus(
        "Public conversation opened. Only published knowledge is available.",
      );
      setPending("");
      transcript.reload();
    });
  }
  async function ask(value: string) {
    if (!value.trim() || task.busy) return;
    setQuestion("");
    setPending(value.trim());
    await task.run(async (signal) => {
      const accepted = await api.widgetMessage(value.trim(), signal);
      if (signal.aborted) return;
      const job: PendingVisitorJob = {
        jobId: accepted.jobId,
        sessionId: session!.sessionId,
        kind: "answer",
      };
      setPendingJob(job);
      savePending(agentId, site, job);
      task.setStatus(`Reply queued: ${accepted.jobId}.`);
      const answer = await api.waitForJob<Answer>(
        null,
        accepted.jobId,
        signal,
        (job) => task.setStatus(`Reply ${job.state}.`),
      );
      if (!signal.aborted) {
        clearPending(agentId, site);
        setPendingJob(null);
        setPending("");
        task.setStatus(
          `Reply completed against published release ${answer.releaseId}.`,
        );
        transcript.reload();
      }
    });
  }
  async function handoff(e: FormEvent) {
    e.preventDefault();
    await task.run(async (signal) => {
      const accepted = await api.widgetHandoff(
        { email: email.trim(), name: name.trim(), message: handoffText.trim() },
        signal,
      );
      if (signal.aborted) return;
      const job: PendingVisitorJob = {
        jobId: accepted.jobId,
        sessionId: session!.sessionId,
        kind: "email",
      };
      setPendingJob(job);
      savePending(agentId, site, job);
      task.setStatus(
        `Email handoff queued (${accepted.escalationId}). It has not been sent yet.`,
      );
      const escalation = await api.waitForJob<Escalation>(
        null,
        accepted.jobId,
        signal,
        (job) => task.setStatus(`Email handoff job: ${job.state}.`),
      );
      if (!signal.aborted)
        task.setStatus(
          escalation.status === "sent"
            ? "Email handoff sent. The support team will reply by email."
            : `Email handoff ${escalation.status}. Delivery has not been confirmed.`,
        );
      if (!signal.aborted) {
        clearPending(agentId, site);
        setPendingJob(null);
      }
      transcript.reload();
    });
  }
  const expired = session
    ? new Date(session.expiresAt).getTime() <= Date.now() ||
      (transcript.error instanceof ApiFailure &&
        transcript.error.status === 401) ||
      (task.error instanceof ApiFailure && task.error.status === 401)
    : false;
  const emailHref =
    session &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(session.config.supportEmail)
      ? `mailto:${encodeURIComponent(session.config.supportEmail)}`
      : null;
  return (
    <main id="main-content" className="widget-app" aria-label="Website support">
      <header
        className="widget-header"
        style={{
          borderTop: `4px solid ${/^#[0-9a-f]{6}$/i.test(session?.config.accentColor ?? "") ? session!.config.accentColor : "#2f6047"}`,
        }}
      >
        <h1>{session?.config.name ?? "Website support"}</h1>
        <span>Answers from published customer-facing knowledge</span>
        {framed && (
          <button
            className="button button-secondary"
            onClick={() =>
              window.parent.postMessage({ type: "lattice:close" }, site)
            }
          >
            Close chat
          </button>
        )}
      </header>
      {!ready ? (
        <Loading label="Preparing support chat…" />
      ) : (
        <>
          {!trustedSite && (
            <p role="alert" className="state-notice state-error">
              The installation origin could not be confirmed. Open this widget
              on the configured website, or use its normal support contact.
            </p>
          )}
          {storageWarning && (
            <p className="state-notice" role="status">
              {storageWarning}
            </p>
          )}
          <TaskNotice task={task} visitor />
          {pendingJob && !task.busy && (
            <div className="state-notice">
              <p>
                Accepted {pendingJob.kind} job {pendingJob.jobId} is retained.
                Resume status observation before sending another request.
              </p>
              <Button
                onClick={() =>
                  task.run((signal) => observePending(pendingJob, signal))
                }
              >
                Resume accepted operation
              </Button>
            </div>
          )}
          {(!session || expired) && (
            <section className="widget-welcome">
              <h2>
                {expired
                  ? "This support session has expired."
                  : "How can we help?"}
              </h2>
              <p>
                {expired
                  ? "The previous conversation was not automatically deleted. Start a new public conversation to continue."
                  : "Start a conversation with this site's published support agent."}
              </p>
              <Button disabled={task.busy || !trustedSite} onClick={start}>
                {expired ? "Start a new conversation" : "Start conversation"}
              </Button>
            </section>
          )}
          {session && !expired && trustedSite && (
            <>
              <div className="widget-transcript">
                <ErrorNotice
                  visitor
                  error={transcript.error}
                  retry={transcript.reload}
                />
                {transcript.loading && !transcript.data && (
                  <Loading label="Loading saved conversation…" />
                )}
                {transcript.data && (
                  <Transcript
                    messages={transcript.data.messages}
                    busy={task.busy}
                    inspectLabel="Download cited source original (may be newer)"
                    inspect={(sourceId) =>
                      task.run(async (signal) => {
                        const blob = await api.asset(null, sourceId, signal);
                        if (!signal.aborted)
                          downloadBlob(`cited-source-${sourceId}`, blob);
                      })
                    }
                    feedback={(message, rating) =>
                      task.run(async (signal) => {
                        await api.widgetFeedback(
                          { messageId: message.id, rating },
                          signal,
                        );
                        if (!signal.aborted)
                          task.setStatus("Feedback recorded. Thank you.");
                      })
                    }
                  />
                )}{" "}
                {pending && (
                  <p className="state-notice">
                    Your submitted question: {pending}
                  </p>
                )}
                {transcript.data?.messages.length === 0 && (
                  <div className="suggested-questions">
                    {session.config.starterQuestions.map((q) => (
                      <button
                        key={q}
                        disabled={task.busy}
                        onClick={() => ask(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(question);
                }}
              >
                <input
                  aria-label="Ask support"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={4000}
                  required
                  placeholder="Ask a question…"
                />
                <Button
                  disabled={task.busy || !!pendingJob || !question.trim()}
                >
                  Send
                </Button>
              </form>
              <details className="widget-handoff">
                <summary>Ask the team to reply by email</summary>
                <p>{session.config.handoffMessage}</p>
                <form className="stack-form" onSubmit={handoff}>
                  <label className="field">
                    Your email
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Your name (optional)
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <label className="field">
                    Extra context (optional)
                    <textarea
                      value={handoffText}
                      onChange={(e) => setHandoffText(e.target.value)}
                      maxLength={4000}
                    />
                  </label>
                  <p>
                    The team will reply by email using this conversation's
                    transcript.
                  </p>
                  <Button disabled={task.busy || !!pendingJob}>
                    Request email handoff
                  </Button>
                </form>
                {transcript.data?.escalations.map((escalation) => (
                  <p className="state-notice" key={escalation.id}>
                    Email handoff{" "}
                    {escalation.status === "pending"
                      ? "queued / pending delivery"
                      : escalation.status}
                    {escalation.lastError ? `: ${escalation.lastError}` : ""}
                  </p>
                ))}
              </details>
            </>
          )}
          <footer className="widget-fallback">
            <p>
              If an allowance is exhausted or chat is unavailable, contact this
              site's support team directly.
            </p>
            {emailHref ? (
              <a className="button button-secondary" href={emailHref}>
                Email support
              </a>
            ) : (
              safeUrl(site) && (
                <a
                  className="button button-secondary"
                  href={safeUrl(site)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Return to website for support
                </a>
              )
            )}
          </footer>
        </>
      )}
    </main>
  );
}
