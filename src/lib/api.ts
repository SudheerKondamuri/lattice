import {
  API_PATHS,
  type Accepted,
  type Agent,
  type BillingLink,
  type Bootstrap,
  type CheckoutRequest,
  type Conversation,
  type ConversationDetail,
  type CreateSource,
  type CreateWorkspace,
  type EvalCase,
  type EvalCaseInput,
  type EvalImport,
  type EvalResult,
  type EvalRun,
  type EvalRunDetail,
  type EvalRunRequest,
  type FeedbackRequest,
  type HandoffAccepted,
  type HandoffRequest,
  type HumanVerdict,
  type InviteMember,
  type Installation,
  type Job,
  type Member,
  type Notification,
  type Page,
  type PublishRequest,
  type Release,
  type ReleaseChecks,
  type Settings,
  type Source,
  type SourceAccepted,
  type SourceDetail,
  type Success,
  type UpdateSettings,
  type UpdateSource,
  type Usage,
  type WidgetSession,
  type WorkspaceDetail,
} from "@/contracts/api";

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}
export function apiPath(template: string, params: Record<string, string> = {}) {
  return template.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    if (!params[key]) throw new Error(`Missing path parameter ${key}`);
    return encodeURIComponent(params[key]);
  });
}
function abortDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
type Options = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  idempotent?: boolean;
  headers?: HeadersInit;
};
export class ApiClient {
  private listeners = new Set<(prefix: string) => void>();
  constructor(
    private token: () => Promise<string | null>,
    private fetcher: typeof fetch = fetch,
    private siteOrigin?: string,
  ) {
    this.fetcher = fetcher.bind(globalThis);
  }
  subscribe(listener: (prefix: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  invalidate(prefix: string) {
    this.listeners.forEach((listener) => listener(prefix));
  }
  async request<T>(path: string, options: Options = {}): Promise<T> {
    const headers = new Headers(options.headers);
    const token = await this.token();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.idempotent) headers.set("Idempotency-Key", crypto.randomUUID());
    const multipart = options.body instanceof FormData;
    if (options.body !== undefined && !multipart)
      headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await this.fetcher(`/api/v1${path}`, {
        method: options.method ?? "GET",
        headers,
        signal: options.signal,
        body:
          options.body === undefined
            ? undefined
            : multipart
              ? (options.body as FormData)
              : JSON.stringify(options.body),
        cache: "no-store",
        credentials: this.siteOrigin ? "omit" : "same-origin",
      });
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        throw error;
      throw new ApiFailure(
        0,
        "NETWORK_ERROR",
        "The connection failed. The request may have reached the server; inspect the current state before trying again.",
      );
    }
    let envelope: Success<T> & {
      error?: { code: string; message: string; details?: unknown };
    };
    try {
      envelope = await response.json();
    } catch {
      throw new ApiFailure(
        response.status,
        "INVALID_RESPONSE",
        "The service returned an unreadable response.",
      );
    }
    if (!response.ok)
      throw new ApiFailure(
        response.status,
        envelope.error?.code ?? "REQUEST_FAILED",
        envelope.error?.message ?? "The request failed.",
        envelope.requestId,
        envelope.error?.details,
      );
    if (
      !envelope ||
      !("data" in envelope) ||
      typeof envelope.requestId !== "string"
    )
      throw new ApiFailure(
        response.status,
        "INVALID_RESPONSE",
        "The service returned no valid receipt.",
      );
    if ((options.method ?? "GET") !== "GET")
      this.invalidate(
        path.startsWith("/workspaces/")
          ? path.split("/").slice(0, 3).join("/")
          : path.startsWith("/public/")
            ? "/public"
            : "/",
      );
    return envelope.data;
  }
  private path(
    key: keyof typeof API_PATHS,
    workspaceId: string,
    params: Record<string, string> = {},
  ) {
    return apiPath(API_PATHS[key], { workspaceId, ...params });
  }
  private list<T>(
    key: keyof typeof API_PATHS,
    workspaceId: string,
    signal?: AbortSignal,
    cursor?: string,
    q?: string,
  ) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    if (q) query.set("q", q);
    return this.request<Page<T>>(`${this.path(key, workspaceId)}?${query}`, {
      signal,
    });
  }
  bootstrap(signal?: AbortSignal) {
    return this.request<Bootstrap>(API_PATHS.bootstrap, { signal });
  }
  createWorkspace(body: CreateWorkspace, signal?: AbortSignal) {
    return this.request<WorkspaceDetail>(API_PATHS.workspaces, {
      method: "POST",
      body,
      signal,
      idempotent: true,
    });
  }
  workspace(id: string, signal?: AbortSignal) {
    return this.request<WorkspaceDetail>(this.path("workspace", id), {
      signal,
    });
  }
  sources(w: string, signal?: AbortSignal, cursor?: string) {
    return this.list<Source>("sources", w, signal, cursor);
  }
  source(w: string, sourceId: string, signal?: AbortSignal) {
    return this.request<SourceDetail>(this.path("source", w, { sourceId }), {
      signal,
    });
  }
  createSource(w: string, body: CreateSource, signal?: AbortSignal) {
    return this.request<SourceAccepted>(this.path("sources", w), {
      method: "POST",
      body,
      signal,
      idempotent: true,
    });
  }
  upload(w: string, body: FormData, signal?: AbortSignal) {
    return this.request<SourceAccepted>(this.path("upload", w), {
      method: "POST",
      body,
      signal,
      idempotent: true,
    });
  }
  updateSource(
    w: string,
    sourceId: string,
    body: UpdateSource,
    signal?: AbortSignal,
  ) {
    return this.request<Source | SourceAccepted>(
      this.path("source", w, { sourceId }),
      { method: "PATCH", body, signal, idempotent: true },
    );
  }
  deleteSource(w: string, sourceId: string, signal?: AbortSignal) {
    return this.request<{ deleted: true }>(
      this.path("source", w, { sourceId }),
      { method: "DELETE", signal },
    );
  }
  reprocess(w: string, sourceId: string, signal?: AbortSignal) {
    return this.request<SourceAccepted>(
      this.path("reprocess", w, { sourceId }),
      { method: "POST", signal, idempotent: true },
    );
  }
  preview(
    w: string,
    body: import("@/contracts/api").PreviewRequest,
    signal?: AbortSignal,
  ) {
    return this.request<Accepted>(this.path("preview", w), {
      method: "POST",
      body,
      signal,
      idempotent: true,
    });
  }
  job<T>(w: string, jobId: string, signal?: AbortSignal) {
    return this.request<Job<T>>(this.path("jobs", w, { jobId }), { signal });
  }
  async waitForJob<T>(
    w: string | null,
    jobId: string,
    signal?: AbortSignal,
    progress?: (job: Job<T>) => void,
    interval = 1200,
  ): Promise<T> {
    for (let attempt = 0; attempt < 150; attempt++) {
      const job = w
        ? await this.job<T>(w, jobId, signal)
        : await this.request<Job<T>>(apiPath(API_PATHS.widgetJobs, { jobId }), {
            signal,
          });
      progress?.(job);
      if (job.state === "failed")
        throw new ApiFailure(
          422,
          job.error?.code ?? "JOB_FAILED",
          job.error?.message ?? "The operation failed.",
          undefined,
          { jobId },
        );
      if (job.state === "succeeded") {
        if (job.result === null)
          throw new ApiFailure(
            502,
            "INVALID_RESPONSE",
            "The completed job has no result.",
          );
        this.invalidate(w ? `/workspaces/${encodeURIComponent(w)}` : "/public");
        return job.result;
      }
      await abortDelay(interval, signal);
    }
    throw new ApiFailure(
      202,
      "JOB_PENDING",
      `Job ${jobId} is still processing. It has not been cancelled. Check its status before submitting another request.`,
      undefined,
      { jobId },
    );
  }
  conversations(w: string, signal?: AbortSignal, cursor?: string, q?: string) {
    return this.list<Conversation>("conversations", w, signal, cursor, q);
  }
  conversation(w: string, conversationId: string, signal?: AbortSignal) {
    return this.request<ConversationDetail>(
      this.path("conversation", w, { conversationId }),
      { signal },
    );
  }
  deleteConversation(w: string, conversationId: string, signal?: AbortSignal) {
    return this.request<{ deleted: true }>(
      this.path("conversation", w, { conversationId }),
      { method: "DELETE", signal },
    );
  }
  feedback(
    w: string,
    conversationId: string,
    body: FeedbackRequest,
    signal?: AbortSignal,
  ) {
    return this.request<{ saved: boolean }>(
      this.path("feedback", w, { conversationId }),
      { method: "POST", body, signal },
    );
  }
  handoff(
    w: string,
    conversationId: string,
    body: HandoffRequest,
    signal?: AbortSignal,
  ) {
    return this.request<HandoffAccepted>(
      this.path("handoff", w, { conversationId }),
      { method: "POST", body, signal, idempotent: true },
    );
  }
  retryEscalation(w: string, escalationId: string, signal?: AbortSignal) {
    return this.request<HandoffAccepted>(
      this.path("escalationRetry", w, { escalationId }),
      { method: "POST", signal, idempotent: true },
    );
  }
  evalCases(w: string, signal?: AbortSignal, cursor?: string) {
    return this.list<EvalCase>("evalCases", w, signal, cursor);
  }
  createCase(w: string, body: EvalCaseInput, signal?: AbortSignal) {
    return this.request<EvalCase>(this.path("evalCases", w), {
      method: "POST",
      body,
      signal,
    });
  }
  updateCase(
    w: string,
    caseId: string,
    body: { expectedRevision: number; input: EvalCaseInput; freeze?: boolean },
    signal?: AbortSignal,
  ) {
    return this.request<EvalCase>(this.path("evalCase", w, { caseId }), {
      method: "PATCH",
      body,
      signal,
    });
  }
  importCases(w: string, body: EvalImport, signal?: AbortSignal) {
    return this.request<Accepted>(this.path("evalImport", w), {
      method: "POST",
      body,
      signal,
      idempotent: true,
    });
  }
  evalRuns(w: string, signal?: AbortSignal, cursor?: string) {
    return this.list<EvalRun>("evalRuns", w, signal, cursor);
  }
  evalRun(w: string, runId: string, signal?: AbortSignal) {
    return this.request<EvalRunDetail>(this.path("evalRun", w, { runId }), {
      signal,
    });
  }
  runEvaluation(w: string, body: EvalRunRequest, signal?: AbortSignal) {
    return this.request<Accepted>(this.path("evalRuns", w), {
      method: "POST",
      body,
      signal,
      idempotent: true,
    });
  }
  verdict(
    w: string,
    resultId: string,
    verdict: HumanVerdict,
    signal?: AbortSignal,
  ) {
    return this.request<EvalResult>(this.path("verdict", w, { resultId }), {
      method: "PUT",
      body: { verdict },
      signal,
    });
  }
  releases(w: string, signal?: AbortSignal, cursor?: string) {
    return this.list<Release>("releases", w, signal, cursor);
  }
  release(w: string, releaseId: string, signal?: AbortSignal) {
    return this.request<Release>(this.path("release", w, { releaseId }), {
      signal,
    });
  }
  snapshot(w: string, label: string, signal?: AbortSignal) {
    return this.request<Release>(this.path("releases", w), {
      method: "POST",
      body: { label },
      signal,
      idempotent: true,
    });
  }
  releaseChecks(w: string, releaseId: string, signal?: AbortSignal) {
    return this.request<ReleaseChecks>(
      this.path("releaseChecks", w, { releaseId }),
      { signal },
    );
  }
  publish(
    w: string,
    releaseId: string,
    body: PublishRequest,
    rollback = false,
    signal?: AbortSignal,
  ) {
    return this.request<Agent>(
      this.path(rollback ? "rollback" : "publish", w, { releaseId }),
      { method: "POST", body, signal },
    );
  }
  settings(w: string, signal?: AbortSignal) {
    return this.request<Settings>(this.path("settings", w), { signal });
  }
  updateSettings(w: string, body: UpdateSettings, signal?: AbortSignal) {
    return this.request<Settings>(this.path("settings", w), {
      method: "PATCH",
      body,
      signal,
    });
  }
  members(w: string, signal?: AbortSignal) {
    return this.request<Member[]>(this.path("members", w), { signal });
  }
  invite(w: string, body: InviteMember, signal?: AbortSignal) {
    return this.request<{ pending: boolean }>(this.path("members", w), {
      method: "POST",
      body,
      signal,
    });
  }
  removeMember(w: string, userId: string, signal?: AbortSignal) {
    return this.request<{ deleted: true }>(this.path("member", w, { userId }), {
      method: "DELETE",
      signal,
    });
  }
  usage(w: string, signal?: AbortSignal) {
    return this.request<Usage>(this.path("usage", w), { signal });
  }
  checkout(w: string, body: CheckoutRequest, signal?: AbortSignal) {
    return this.request<BillingLink>(this.path("checkout", w), {
      method: "POST",
      body,
      signal,
      idempotent: true,
    });
  }
  portal(w: string, signal?: AbortSignal) {
    return this.request<BillingLink>(this.path("portal", w), {
      method: "POST",
      signal,
    });
  }
  notifications(w: string, signal?: AbortSignal, cursor?: string) {
    return this.list<Notification>("notifications", w, signal, cursor);
  }
  widgetSession(agentId: string, signal?: AbortSignal) {
    return this.request<WidgetSession>(API_PATHS.widgetSessions, {
      method: "POST",
      body: {
        agentId,
        ...(this.siteOrigin ? { parentOrigin: this.siteOrigin } : {}),
        loaderVersion: '1',
      } satisfies import("@/contracts/api").WidgetSessionRequest,
      signal,
    });
  }
  installations(w:string,signal?:AbortSignal){return this.request<Installation[]>(this.path('installations',w),{signal});}
  widgetConversation(signal?: AbortSignal) {
    return this.request<ConversationDetail>(API_PATHS.widgetConversation, {
      signal,
    });
  }
  widgetMessage(question: string, signal?: AbortSignal) {
    return this.request<Accepted>(API_PATHS.widgetMessages, {
      method: "POST",
      body: { question },
      signal,
      idempotent: true,
    });
  }
  widgetFeedback(body: FeedbackRequest, signal?: AbortSignal) {
    return this.request<{ saved: boolean }>(API_PATHS.widgetFeedback, {
      method: "POST",
      body,
      signal,
    });
  }
  widgetHandoff(body: HandoffRequest, signal?: AbortSignal) {
    return this.request<HandoffAccepted>(API_PATHS.widgetHandoff, {
      method: "POST",
      body,
      signal,
      idempotent: true,
    });
  }
  async asset(w: string | null, sourceId: string, signal?: AbortSignal) {
    const path = w
      ? this.path("asset", w, { sourceId })
      : apiPath(API_PATHS.widgetAsset, { sourceId });
    const token = await this.token();
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await this.fetcher(`/api/v1${path}`, {
      headers,
      signal,
      cache: "no-store",
      credentials: this.siteOrigin ? "omit" : "same-origin",
    });
    if (!response.ok) {
      const body = await response.json();
      throw new ApiFailure(
        response.status,
        body.error?.code ?? "ASSET_UNAVAILABLE",
        body.error?.message ?? "This source is no longer available.",
        body.requestId,
      );
    }
    return response.blob();
  }
}
