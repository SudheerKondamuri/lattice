import type { WidgetSession } from "@/contracts/api";
export function widgetStorageKey(agentId: string, site: string) {
  return `lattice-visitor-v1:${encodeURIComponent(agentId)}:${encodeURIComponent(site)}`;
}
export function readVisitor(
  agentId: string,
  site: string,
): WidgetSession | null {
  try {
    const raw = localStorage.getItem(widgetStorageKey(agentId, site));
    const data = raw ? JSON.parse(raw) : null;
    return data &&
      typeof data.token === "string" &&
      typeof data.expiresAt === "string" &&
      typeof data.conversationId === "string" &&
      data.config
      ? data
      : null;
  } catch {
    return null;
  }
}
export function saveVisitor(
  agentId: string,
  site: string,
  session: WidgetSession,
) {
  try {
    localStorage.setItem(
      widgetStorageKey(agentId, site),
      JSON.stringify(session),
    );
    return true;
  } catch {
    return false;
  }
}
export type PendingVisitorJob = {
  jobId: string;
  sessionId: string;
  kind: "answer" | "email";
};
export function savePending(
  agentId: string,
  site: string,
  job: PendingVisitorJob,
) {
  try {
    localStorage.setItem(
      `${widgetStorageKey(agentId, site)}:pending`,
      JSON.stringify(job),
    );
    return true;
  } catch {
    return false;
  }
}
export function readPending(
  agentId: string,
  site: string,
  sessionId: string,
): PendingVisitorJob | null {
  try {
    const raw = localStorage.getItem(
      `${widgetStorageKey(agentId, site)}:pending`,
    );
    const data = raw ? JSON.parse(raw) : null;
    return data &&
      data.sessionId === sessionId &&
      typeof data.jobId === "string" &&
      ["answer", "email"].includes(data.kind)
      ? data
      : null;
  } catch {
    return null;
  }
}
export function clearPending(agentId: string, site: string) {
  try {
    localStorage.removeItem(`${widgetStorageKey(agentId, site)}:pending`);
  } catch {
    /* A retained receipt remains safe to read; no mutation replay. */
  }
}
