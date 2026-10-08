"use client";
import Link from "next/link";
import { useWorkspace, useWorkspaceHref } from "@/lib/store";
import { useResource } from "@/lib/resources";
import { formatDate } from "@/lib/presentation";
import { Badge, Empty, PageHeader } from "../ui";
import { ErrorNotice, Loading } from "../async-state";
export function Overview() {
  const { api, workspaceId: w, detail, owner } = useWorkspace(),
    href = useWorkspaceHref();
  const sources = useResource(api, `/workspaces/${w}/sources`, (s) =>
    api.sources(w, s),
  );
  const usage = useResource(api, `/workspaces/${w}/usage`, (s) =>
    api.usage(w, s),
  );
  const conversations = useResource(
    api,
    `/workspaces/${w}/conversations`,
    (s) => api.conversations(w, s),
  );
  const notifications = useResource(
    api,
    `/workspaces/${w}/notifications`,
    (s) => api.notifications(w, s),
  );
  const release = useResource(
    api,
    detail?.agent.publishedReleaseId
      ? `/workspaces/${w}/releases/${detail.agent.publishedReleaseId}`
      : null,
    (s) => api.release(w, detail!.agent.publishedReleaseId!, s),
  );
  const issues =
    sources.data?.items.filter(
      (s) =>
        s.held ||
        s.processingState === "failed" ||
        s.processingState === "partial" ||
        s.warnings.length,
    ) ?? [];
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="YOUR WORKSPACE, AT A GLANCE"
        title="A little more clarity."
        description="Actual processing, releases, usage, and activity. No illustrative growth charts."
      >
        <Link
          className="button button-secondary"
          href={href("/app/playground")}
        >
          Preview agent
        </Link>
        {owner && (
          <Link
            className="button button-primary"
            href={href("/app/knowledge?import=1")}
          >
            Add knowledge
          </Link>
        )}
      </PageHeader>
      <div className="overview-metrics">
        <div className="metric">
          <span>Reply allowance</span>
          {usage.loading ? (
            <Loading />
          ) : usage.data ? (
            <>
              <strong>
                {usage.data.used.reply}
                <small>/ {usage.data.limits.replies}</small>
              </strong>
              <p>
                {usage.data.reserved.reply} reserved · {usage.data.status}
              </p>
            </>
          ) : (
            <ErrorNotice error={usage.error} retry={usage.reload} />
          )}
        </div>
        <div className="metric">
          <span>Loaded sources</span>
          {sources.loading ? (
            <Loading />
          ) : sources.data ? (
            <>
              <strong>{sources.data.items.length}</strong>
              <p>
                {
                  sources.data.items.filter((s) =>
                    ["queued", "processing"].includes(s.processingState),
                  ).length
                }{" "}
                processing
                {sources.data.nextCursor ? " · more pages available" : ""}
              </p>
            </>
          ) : (
            <ErrorNotice error={sources.error} retry={sources.reload} />
          )}
        </div>
        <div className="metric">
          <span>Source issues in loaded page</span>
          <strong>{sources.data ? issues.length : "—"}</strong>
          <p>Failed, partial, warnings, or withheld</p>
        </div>
        <div className="metric">
          <span>Published release</span>
          <strong>
            {detail?.agent.publishedReleaseId
              ? (release.data?.label ?? "Published")
              : "None"}
          </strong>
          <p className="break-anywhere">
            {detail?.agent.publishedReleaseId ??
              "Review and publish your first release"}
          </p>
          <ErrorNotice error={release.error} retry={release.reload} />
        </div>
      </div>
      <div className="overview-middle">
        <section className="panel">
          <div className="panel-heading">
            <h2>Needs attention</h2>
            <Link className="subtle-link" href={href("/app/knowledge")}>
              Knowledge
            </Link>
          </div>
          {sources.loading && <Loading />}
          {!!sources.error && (
            <ErrorNotice error={sources.error} retry={sources.reload} />
          )}{" "}
          {sources.data &&
            (issues.length ? (
              issues.map((s) => (
                <Link
                  key={s.id}
                  className="data-row"
                  href={href(
                    `/app/knowledge?source=${encodeURIComponent(s.id)}`,
                  )}
                >
                  <strong>{s.title}</strong>
                  <Badge
                    tone={
                      s.processingState === "failed" || s.held ? "red" : "amber"
                    }
                  >
                    {s.held ? "Withheld" : s.processingState}
                  </Badge>
                  <small>
                    {s.warnings.join(" · ") || "Inspect processing details"}
                  </small>
                </Link>
              ))
            ) : (
              <Empty
                title="No issues in this source page."
                description="This is not an accuracy score. Review checks and live conversations as well."
              />
            ))}
          <Link href={href("/app/compare")} className="button button-secondary">
            Review checks
          </Link>
        </section>
        <section className="panel">
          <h2>Usage & release</h2>
          {usage.data && (
            <dl className="metadata-list">
              <dt>Plan / subscription</dt>
              <dd>
                {usage.data.plan} · {usage.data.status}
              </dd>
              <dt>Current usage period ends</dt>
              <dd>{formatDate(usage.data.periodEnd)} UTC</dd>
              <dt>Checks used / reserved / limit</dt>
              <dd>
                {usage.data.used.check} / {usage.data.reserved.check} /{" "}
                {usage.data.limits.checks}
              </dd>
              <dt>Recorded spend</dt>
              <dd>${(usage.data.spentMicros / 1000000).toFixed(2)}</dd>
            </dl>
          )}
          <p>Draft revision: {detail?.agent.draftRevision}</p>
          <p>Published {formatDate(release.data?.publishedAt)}</p>
          <Link
            className="button button-secondary"
            href={href("/app/releases")}
          >
            Inspect releases
          </Link>
        </section>
      </div>
      <div className="overview-bottom">
        <section className="panel">
          <h2>Recent conversations</h2>
          <ErrorNotice
            error={conversations.error}
            retry={conversations.reload}
          />
          {conversations.loading && <Loading />}
          {conversations.data &&
            (conversations.data.items.length ? (
              conversations.data.items.slice(0, 6).map((c) => (
                <Link
                  key={c.id}
                  className="data-row"
                  href={href(`/app/conversations?id=${c.id}`)}
                >
                  <strong className="break-anywhere">{c.id}</strong>
                  <Badge>{c.mode}</Badge>
                  <small>{formatDate(c.updatedAt)} UTC</small>
                </Link>
              ))
            ) : (
              <Empty
                title="No conversations yet."
                description="Preview your agent or install the published widget."
              />
            ))}
        </section>
        <section className="panel">
          <h2>Backend activity & maintenance</h2>
          <ErrorNotice
            error={notifications.error}
            retry={notifications.reload}
          />
          {notifications.loading && <Loading />}
          {notifications.data &&
            (notifications.data.items.length ? (
              notifications.data.items.slice(0, 8).map((n) => (
                <article className="data-row" key={n.id}>
                  <strong>{n.summary}</strong>
                  <small>
                    {n.kind} · {formatDate(n.createdAt)}
                  </small>
                </article>
              ))
            ) : (
              <Empty
                title="No activity receipts yet."
                description="Maintenance notifications appear here when produced by the backend."
              />
            ))}
        </section>
      </div>
    </div>
  );
}
