"use client";
import Link from "next/link";
import { ApiFailure } from "@/lib/api";
export function Loading({
  label = "Loading workspace data…",
}: {
  label?: string;
}) {
  return (
    <p className="state-notice" role="status" aria-live="polite">
      {label}
    </p>
  );
}
export function ErrorNotice({
  error,
  retry,
  visitor = false,
}: {
  error: unknown;
  retry?: () => void;
  visitor?: boolean;
}) {
  if (!error) return null;
  const api = error instanceof ApiFailure ? error : null;
  const expired = api?.status === 401;
  return (
    <div role="alert" className="state-notice state-error">
      <strong>
        {expired
          ? visitor
            ? "Support session expired. Start a new conversation or contact the team directly."
            : "Session expired — sign in again."
          : api?.status === 403
            ? "You do not have permission for this action."
            : api?.status === 409 || api?.status === 412
              ? "This data changed. Reload and review before saving again."
              : api?.status === 429
                ? "Allowance or rate limit reached. No extra allowance has been purchased."
                : api?.status === 503
                  ? "Service unavailable"
                  : "The operation did not complete."}
      </strong>
      <p>
        {error instanceof Error ? error.message : "Unexpected service failure."}
      </p>
      {api?.requestId && <small>Request receipt: {api.requestId}</small>}
      {api?.details !== undefined && (
        <details>
          <summary>Validation / service details</summary>
          <pre>{JSON.stringify(api.details, null, 2)}</pre>
        </details>
      )}
      {expired && !visitor && (
        <Link className="button button-secondary" href="/auth/sign-in">
          Sign in again
        </Link>
      )}
      {retry && !expired && (
        <button className="button button-secondary" onClick={retry}>
          Reload current state
        </button>
      )}
    </div>
  );
}
export function TaskNotice({
  task,
  visitor = false,
}: {
  task: { busy: boolean; status: string; error: unknown; cancel: () => void };
  visitor?: boolean;
}) {
  return (
    <>
      <ErrorNotice error={task.error} visitor={visitor} />
      {task.status && !task.busy && (
        <p className="state-notice" role="status">
          {task.status}
        </p>
      )}
      {task.busy && (
        <p role="status" className="state-notice">
          {task.status || "Waiting for a backend receipt…"}{" "}
          <button
            type="button"
            className="button button-ghost"
            onClick={task.cancel}
          >
            Stop waiting
          </button>
        </p>
      )}
    </>
  );
}
