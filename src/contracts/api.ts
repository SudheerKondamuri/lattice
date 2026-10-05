/** Lattice API v1. Dependency-free; safe to import into browser bundles. */
export type UUID = string;
export type ISODate = string;
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Success<T> {
  data: T;
  requestId: string;
}
export interface ApiError {
  error: { code: string; message: string; details?: Json };
  requestId: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export type Role = "owner" | "member";
export type Authority = "approved" | "authoritative" | "reference";
export type SourceKind =
  | "website"
  | "sitemap"
  | "pdf"
  | "text"
  | "markdown"
  | "qa_csv"
  | "qa_xlsx"
  | "approved_answer";
export type JobState = "queued" | "running" | "succeeded" | "failed";
export interface Accepted {
  jobId: UUID;
}
export interface Job<T = Json> {
  id: UUID;
  kind: string;
  state: JobState;
  attempts: number;
  result: T | null;
  error: { code: string; message: string } | null;
  createdAt: ISODate;
  finishedAt: ISODate | null;
  steps?: PipelineStep[];
}
export interface PipelineStep {
  stage: string;
  state: "running" | "succeeded" | "failed";
  details: Json;
  startedAt: ISODate;
  finishedAt: ISODate | null;
}
export interface RagPolicy {
  topK: number;
  minSimilarity: number;
  chunkSizeChars: number;
  chunkOverlapChars: number;
  maxHistoryChars: number;
}
export interface CrawlPolicy {
  maxPages: number;
  excludePaths: string[];
  selectedUrls: string[];
}
export type ApiJob = Job<Json>;
export interface AgentConfig {
  name: string;
  description: string;
  tone: string;
  instructions: string;
  supportEmail: string;
  handoffMessage: string;
  accentColor: string;
  starterQuestions: string[];
  allowedOrigins: string[];
  autoPublish: boolean;
  ragPolicy?: RagPolicy;
}
export interface Workspace {
  id: UUID;
  name: string;
  role: Role;
  createdAt: ISODate;
}
export interface Agent {
  id: UUID;
  workspaceId: UUID;
  draftConfig: AgentConfig;
  publishedReleaseId: UUID | null;
  draftRevision: number;
}
export interface Bootstrap {
  user: { id: UUID; email: string };
  workspaces: Workspace[];
}
export interface CreateWorkspace {
  name: string;
  agentName: string;
  supportEmail: string;
  websiteUrl?: string;
}
export interface WorkspaceDetail {
  workspace: Workspace;
  agent: Agent;
}
export interface Member {
  userId: UUID;
  email: string;
  role: Role;
}
/** Invitation is accepted on bootstrap by the verified Supabase email. */
export interface InviteMember {
  email: string;
  role: "member";
}
export interface Source {
  id: UUID;
  workspaceId: UUID;
  title: string;
  kind: SourceKind;
  url: string | null;
  authority: Authority;
  approvalRequired: boolean;
  status: "active" | "archived" | "deleted";
  held: boolean;
  draftVersionId: UUID | null;
  publishedVersionId: UUID | null;
  processingState: "queued" | "processing" | "ready" | "partial" | "failed";
  warnings: string[];
  lastCheckedAt: ISODate | null;
  createdAt: ISODate;
  revision: number;
  crawlPolicy?: CrawlPolicy;
}
/** Files use multipart/form-data at /sources/upload (file, title, kind, authority, approvalRequired). */
export interface CreateSource {
  title: string;
  kind: SourceKind;
  url?: string;
  content?: string;
  authority?: Authority;
  approvalRequired?: boolean;
  dependsOnSourceIds?: UUID[];
  crawlPolicy?: CrawlPolicy;
}
export interface UpdateSource {
  expectedRevision: number;
  title?: string;
  authority?: Authority;
  approvalRequired?: boolean;
  action?: "archive" | "restore";
  content?: string;
  dependsOnSourceIds?: UUID[];
  crawlPolicy?: CrawlPolicy;
}
export interface SourceVersion {
  id: UUID;
  sourceId: UUID;
  contentHash: string;
  content: string;
  pageCount: number;
  warnings: string[];
  createdAt: ISODate;
  references: { page?: number; section?: string; url?: string }[];
}
export interface SourceDetail {
  source: Source;
  versions: SourceVersion[];
}
export interface SourceAccepted extends Accepted {
  sourceId: UUID;
}
export interface Evidence {
  sourceId: UUID;
  sourceVersionId: UUID;
  chunkId: UUID;
  title: string;
  authority: Authority;
  excerpt: string;
  page?: number;
  section?: string;
  url?: string;
  eligible: boolean;
}
export type Disposition = "answer" | "clarification" | "handoff";
export interface Answer {
  conversationId: UUID;
  messageId: UUID;
  releaseId: UUID;
  content: string;
  disposition: Disposition;
  evidence: Evidence[];
  model: string | null;
  promptVersion: string;
  createdAt: ISODate;
}
export interface PreviewRequest {
  question: string;
  conversationId?: UUID;
  releaseId?: UUID;
}
export interface Conversation {
  id: UUID;
  mode: "preview" | "visitor" | "evaluation";
  createdAt: ISODate;
  updatedAt: ISODate;
  unhelpfulCount?: number;
}
export interface Message {
  id: UUID;
  role: "user" | "assistant";
  content: string;
  releaseId: UUID | null;
  disposition: Disposition | null;
  evidence: Evidence[];
  createdAt: ISODate;
}
export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  escalations: Escalation[];
  feedback?: StoredFeedback[];
}
export interface StoredFeedback {
  id: UUID;
  messageId: UUID;
  rating: "helpful" | "unhelpful";
  comment: string | null;
  createdAt: ISODate;
}
export interface FeedbackRequest {
  messageId: UUID;
  rating: "helpful" | "unhelpful";
  comment?: string;
}
export interface HandoffRequest {
  email: string;
  name?: string;
  message?: string;
}
export interface Escalation {
  id: UUID;
  conversationId: UUID;
  status: "pending" | "sent" | "failed";
  email: string;
  attempts: number;
  lastError: string | null;
  sentAt: ISODate | null;
  createdAt: ISODate;
}
export interface HandoffAccepted extends Accepted {
  escalationId: UUID;
  status: "pending";
}
export interface EvalCaseInput {
  caseId?: string;
  question: string;
  conversationContext?: string;
  previousAnswer?: string;
  expectedFacts: string[];
  sourceIds?: UUID[];
  category?: string;
  importance: "normal" | "critical";
  split: "development" | "holdout";
  baselineTimestamp?: ISODate;
  control?: boolean;
}
export interface EvalCase extends EvalCaseInput {
  id: UUID;
  revision: number;
  frozen: boolean;
  createdAt: ISODate;
}
export interface EvalImport {
  cases?: EvalCaseInput[];
  csv?: string;
}
export interface EvalRunRequest {
  releaseId: UUID;
  caseIds?: UUID[];
}
export interface EvalRun {
  id: UUID;
  releaseId: UUID;
  state: JobState;
  jobId: UUID;
  createdAt: ISODate;
  limitations: string[];
}
export type HumanVerdict =
  "candidate_better" | "baseline_better" | "tie" | "ungradable";
export interface EvalResult {
  id: UUID;
  caseId: UUID;
  caseSnapshot: EvalCaseInput;
  answer: Answer | null;
  deterministic: { missingFacts: string[]; eligibleCitations: boolean };
  preliminaryGrade: Json | null;
  humanVerdict: HumanVerdict | null;
  reviewedBy: UUID | null;
  error: string | null;
}
export interface EvalRunDetail {
  run: EvalRun;
  results: EvalResult[];
}
export interface Release {
  id: UUID;
  label: string;
  config: AgentConfig;
  sourceVersionIds: UUID[];
  draftRevision: number;
  createdAt: ISODate;
  publishedAt: ISODate | null;
}
export interface ReleaseChecks {
  releaseId: UUID;
  latestRunId: UUID | null;
  failures: number;
  regressions: number;
  unreviewed: number;
  criticalUnreviewed: number;
  warnings: string[];
}
/** Owner must explicitly acknowledge visible failing/unreviewed checks to override. */
export interface PublishRequest {
  expectedPublishedReleaseId: UUID | null;
  acknowledgeWarnings: boolean;
}
export interface Settings {
  revision: number;
  agent: Agent;
  retentionDays: number;
  monthlySpendLimitMicros: number;
  automaticOverages: false;
  billingEnabled?: boolean;
}
export interface UpdateSettings {
  expectedRevision: number;
  config?: Partial<AgentConfig>;
  retentionDays?: number;
  monthlySpendLimitMicros?: number;
}
export type UsageKind = "reply" | "check" | "embedding" | "ocr" | "preview";
export interface Usage {
  periodStart: ISODate;
  periodEnd: ISODate;
  plan: "trial" | "starter" | "growth";
  status: string;
  limits: {
    replies: number;
    checks: number;
    sourcePages: number;
    ocrPages: number;
    members: number;
  };
  used: Record<UsageKind, number>;
  reserved: Record<UsageKind, number>;
  spentMicros: number;
  reservedMicros: number;
  monthlySpendLimitMicros: number;
  automaticOverages: false;
  indexedPages?: number;
  storageBytes?: number;
  billingEnabled?: boolean;
}
export interface BillingLink {
  url: string;
}
export interface CheckoutRequest {
  plan: "starter" | "growth";
}
/** Hosted iframes send the validated postMessage parent origin; direct embeds use their browser Origin. */
export interface WidgetSessionRequest {
  agentId: UUID;
  parentOrigin?: string;
  loaderVersion?: string;
}
/** Store the opaque token only in widget-owned storage; it is not a dashboard token. */
export interface WidgetSession {
  sessionId: UUID;
  token: string;
  expiresAt: ISODate;
  conversationId: UUID;
  config: Pick<
    AgentConfig,
    | "name"
    | "accentColor"
    | "starterQuestions"
    | "handoffMessage"
    | "supportEmail"
  >;
}
export interface WidgetMessageRequest {
  question: string;
}
export interface Notification {
  id: UUID;
  kind: string;
  summary: string;
  createdAt: ISODate;
  readAt: ISODate | null;
}
export interface Installation {
  agentId: UUID;
  siteOrigin: string;
  lastObservedAt: ISODate;
  loaderVersion: string;
  releaseId: UUID;
  sessionCount: number;
}

/** Every path below is relative to /api/v1. UUID parameters are URL-encoded. */
export const API_PATHS = {
  bootstrap: "/bootstrap",
  workspaces: "/workspaces",
  workspace: "/workspaces/:workspaceId",
  sources: "/workspaces/:workspaceId/sources",
  upload: "/workspaces/:workspaceId/sources/upload",
  source: "/workspaces/:workspaceId/sources/:sourceId",
  reprocess: "/workspaces/:workspaceId/sources/:sourceId/reprocess",
  asset: "/workspaces/:workspaceId/sources/:sourceId/asset",
  preview: "/workspaces/:workspaceId/preview",
  conversations: "/workspaces/:workspaceId/conversations",
  conversation: "/workspaces/:workspaceId/conversations/:conversationId",
  feedback: "/workspaces/:workspaceId/conversations/:conversationId/feedback",
  handoff: "/workspaces/:workspaceId/conversations/:conversationId/handoff",
  escalationRetry: "/workspaces/:workspaceId/escalations/:escalationId/retry",
  evalCases: "/workspaces/:workspaceId/evaluation/cases",
  evalImport: "/workspaces/:workspaceId/evaluation/import",
  evalCase: "/workspaces/:workspaceId/evaluation/cases/:caseId",
  evalRuns: "/workspaces/:workspaceId/evaluation/runs",
  evalRun: "/workspaces/:workspaceId/evaluation/runs/:runId",
  verdict: "/workspaces/:workspaceId/evaluation/results/:resultId/verdict",
  releases: "/workspaces/:workspaceId/releases",
  release: "/workspaces/:workspaceId/releases/:releaseId",
  releaseChecks: "/workspaces/:workspaceId/releases/:releaseId/checks",
  publish: "/workspaces/:workspaceId/releases/:releaseId/publish",
  rollback: "/workspaces/:workspaceId/releases/:releaseId/rollback",
  settings: "/workspaces/:workspaceId/settings",
  members: "/workspaces/:workspaceId/members",
  member: "/workspaces/:workspaceId/members/:userId",
  usage: "/workspaces/:workspaceId/usage",
  checkout: "/workspaces/:workspaceId/billing/checkout",
  portal: "/workspaces/:workspaceId/billing/portal",
  jobs: "/workspaces/:workspaceId/jobs/:jobId",
  notifications: "/workspaces/:workspaceId/notifications",
  installations: "/workspaces/:workspaceId/installations",
  widgetSessions: "/public/sessions",
  widgetConversation: "/public/conversation",
  widgetMessages: "/public/messages",
  widgetFeedback: "/public/feedback",
  widgetHandoff: "/public/handoff",
  widgetJobs: "/public/jobs/:jobId",
  widgetAsset: "/public/sources/:sourceId/asset",
  stripeWebhook: "/webhooks/stripe",
} as const;
