"use client";
import { useEffect, useState } from "react";
import type { AgentConfig, Settings as AgentSettings } from "@/contracts/api";
import { useWorkspace } from "@/lib/store";
import { useResource, useTask } from "@/lib/resources";
import { formatDate, safeUrl } from "@/lib/presentation";
import { Badge, Button, PageHeader } from "../ui";
import { ErrorNotice, Loading, TaskNotice } from "../async-state";
import { LegacyDataExport } from "../legacy-export";

function ConfigurationEditor({ data }: { data: AgentSettings }) {
  const { owner, api, workspaceId: w } = useWorkspace();
  const [config, setConfig] = useState<AgentConfig>(data.agent.draftConfig),
     [revision, setRevision] = useState(data.revision ?? data.agent.draftRevision),
     [notice, setNotice] = useState("");
  const task = useTask(`settings:${w}`);
  const fields: {
    key: keyof Pick<
      AgentConfig,
      | "name"
      | "description"
      | "tone"
      | "instructions"
      | "supportEmail"
      | "handoffMessage"
      | "accentColor"
    >;
    label: string;
    multiline?: boolean;
  }[] = [
    { key: "name", label: "Agent name" },
    { key: "description", label: "Business description", multiline: true },
    { key: "tone", label: "Tone" },
    { key: "instructions", label: "Advanced instructions", multiline: true },
    { key: "supportEmail", label: "Support contact email" },
    { key: "handoffMessage", label: "Email handoff wording", multiline: true },
    { key: "accentColor", label: "Brand accent color (#RRGGBB)" },
  ];
  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
         task.run(async signal=>{const saved=await api.updateSettings(w,{expectedRevision:revision,config},signal);if(!signal.aborted){setRevision(saved.revision);setNotice('Saved draft settings. Create a new release to publish them.');}});
      }}
    >
      <h2>Agent behavior & branding — draft</h2>
      {fields.map((field) => (
        <label className="field" key={field.key}>
          {field.label}
          {field.multiline ? (
            <textarea
              value={config[field.key]}
              disabled={!owner}
              onChange={(e) =>
                setConfig((c) => ({ ...c, [field.key]: e.target.value }))
              }
            />
          ) : (
            <input
              value={config[field.key]}
              disabled={!owner}
              type={field.key === "supportEmail" ? "email" : "text"}
              onChange={(e) =>
                setConfig((c) => ({ ...c, [field.key]: e.target.value }))
              }
            />
          )}
        </label>
      ))}
      <label className="field">
        Starter questions (one per line, up to 6)
        <textarea
          disabled={!owner}
          value={config.starterQuestions.join("\n")}
          onChange={(e) =>
            setConfig((c) => ({
              ...c,
              starterQuestions: e.target.value.split("\n"),
            }))
          }
        />
      </label>
      <label className="field">
        Allowed site origins (one per line)
        <textarea
          disabled={!owner}
          value={config.allowedOrigins.join("\n")}
          onChange={(e) =>
            setConfig((c) => ({
              ...c,
              allowedOrigins: e.target.value.split("\n"),
            }))
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          disabled={!owner}
          checked={config.autoPublish}
          onChange={(e) =>
            setConfig((c) => ({ ...c, autoPublish: e.target.checked }))
          }
        />{" "}
        Opt in to ordinary-source automatic publication after checks
        (approval-required sources still require owner review)
      </label>
      <h3>Knowledge factory policy</h3>
      <p className="state-notice">These bounded policies control retrieval and chunking for the next draft release.</p>
      <label className="field">Evidence passages (1–8)<input type="number" min={1} max={8} value={config.ragPolicy?.topK ?? 6} disabled={!owner} onChange={e=>setConfig(c=>({...c,ragPolicy:{topK:Number(e.target.value),minSimilarity:c.ragPolicy?.minSimilarity??0.45,chunkSizeChars:c.ragPolicy?.chunkSizeChars??2400,chunkOverlapChars:c.ragPolicy?.chunkOverlapChars??400,maxHistoryChars:c.ragPolicy?.maxHistoryChars??6000}}))}/></label>
      <label className="field">Minimum retrieval similarity<input type="number" min={0} max={1} step={0.05} value={config.ragPolicy?.minSimilarity ?? 0.45} disabled={!owner} onChange={e=>setConfig(c=>({...c,ragPolicy:{topK:c.ragPolicy?.topK??6,minSimilarity:Number(e.target.value),chunkSizeChars:c.ragPolicy?.chunkSizeChars??2400,chunkOverlapChars:c.ragPolicy?.chunkOverlapChars??400,maxHistoryChars:c.ragPolicy?.maxHistoryChars??6000}}))}/></label>
      <label className="field">Maximum conversation history characters<input type="number" min={0} max={6000} value={config.ragPolicy?.maxHistoryChars ?? 6000} disabled={!owner} onChange={e=>setConfig(c=>({...c,ragPolicy:{topK:c.ragPolicy?.topK??6,minSimilarity:c.ragPolicy?.minSimilarity??0.45,chunkSizeChars:c.ragPolicy?.chunkSizeChars??2400,chunkOverlapChars:c.ragPolicy?.chunkOverlapChars??400,maxHistoryChars:Number(e.target.value)}}))}/></label>
       <p className="state-notice">Changes use atomic expected revisions. Origin allowlists are deployment policy, not visitor authentication. Published configuration changes only through a release.</p>
      {notice && (
        <p role="alert" className="state-notice">
          {notice}
        </p>
      )}
       <Button variant="secondary" disabled={!owner || task.busy}>Save draft settings</Button>
      <h3>Persisted limits</h3>
      <p>
        Retention {data.retentionDays} days · monthly spending cap $
        {(data.monthlySpendLimitMicros / 1000000).toFixed(2)} · automatic
        overages {String(data.automaticOverages)}.
      </p>
      <details>
        <summary>Persisted draft configuration receipt</summary>
        <pre>{JSON.stringify(data.agent.draftConfig, null, 2)}</pre>
      </details>
    </form>
  );
}
export function Settings() {
  const { api, workspaceId: w, detail, owner } = useWorkspace();
  const settings = useResource(api, `/workspaces/${w}/settings`, (s) =>
    api.settings(w, s),
  );
  const members = useResource(api, `/workspaces/${w}/members`, (s) =>
    api.members(w, s),
  );
  const usage = useResource(api, `/workspaces/${w}/usage`, (s) =>
    api.usage(w, s),
  );
  const installations = useResource(api, `/workspaces/${w}/installations`, (s) => api.installations(w, s));
  const [origin, setOrigin] = useState(""),
    [email, setEmail] = useState(""),
    [plan, setPlan] = useState<"starter" | "growth">("starter");
  const task = useTask(w);
  useEffect(() => setOrigin(location.origin), []);
  const embed =
    detail && origin
      ? `<script src="${origin}/lattice-widget.js" data-agent="${detail.agent.id}" defer></script>`
      : "";
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="MAKE IT YOUR OWN"
        title="A considered setup."
        description="Persisted agent configuration, deployment, members, real usage, and backend-issued billing links."
      />
      <TaskNotice task={task} />
      <div className="settings-grid">
        <section className="panel">
          <ErrorNotice error={settings.error} retry={settings.reload} />
          {settings.loading && !settings.data && <Loading />}
          {settings.data && <ConfigurationEditor data={settings.data} />}
        </section>
        <div className="stack-form">
          <section className="panel stack-form">
            <h2>Website installation</h2>
            <p>Agent ID: {detail?.agent.id}</p>
            <Badge tone={detail?.agent.publishedReleaseId ? "green" : "amber"}>
              {detail?.agent.publishedReleaseId
                ? "Published release available"
                : "Publish before visitor preview"}
            </Badge>
            <label className="field">
              Copyable embed snippet
              <textarea
                readOnly
                value={embed}
                aria-label="Embed snippet"
                rows={3}
              />
            </label>
            <Button
              variant="secondary"
              disabled={!embed}
              onClick={() =>
                task.run(async () => {
                  await navigator.clipboard.writeText(embed);
                  task.setStatus(
                    "Embed snippet copied to clipboard. This does not verify installation.",
                  );
                })
              }
            >
              Copy embed snippet
            </Button>
            <p>
              Allow your staging/production site origin in the published
              deployment settings. Install this script on a chosen staging page
              first. The iframe uses only public widget endpoints, never
              dashboard tokens or private workspace data.
            </p>
            {origin && (
              <a
                className="button button-secondary"
                href={`/widget?agent=${encodeURIComponent(detail?.agent.id ?? "")}&site=${encodeURIComponent(origin)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open genuine public-widget preview
              </a>
            )}
            <p className="state-notice">
               Preview requests use the current public release and consume real visitor allowance. The preview origin must be allowed by the published configuration.
            </p>
            <h3>Observed installations</h3>
            {installations.data?.length ? installations.data.map(item=><p key={item.siteOrigin} className="state-notice">{item.siteOrigin} · last observed {formatDate(item.lastObservedAt)} · {item.sessionCount} sessions</p>) : <p className="state-notice">No widget session has been observed yet.</p>}
          </section>
          <section className="panel stack-form">
            <h2>Members</h2>
            <ErrorNotice error={members.error} retry={members.reload} />
            {members.loading && !members.data && <Loading />}
            {members.data?.map((member) => (
              <div className="data-row" key={member.userId}>
                <strong>{member.email}</strong>
                <Badge>{member.role}</Badge>
                {owner && member.role !== "owner" && (
                  <Button
                    variant="danger"
                    disabled={task.busy}
                    onClick={() =>
                      task.run(async (signal) => {
                        await api.removeMember(w, member.userId, signal);
                        if (!signal.aborted)
                          task.setStatus("Member removed by the backend.");
                      })
                    }
                  >
                    Remove member
                  </Button>
                )}
              </div>
            ))}
            {owner && (
              <form
                className="stack-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  task.run(async (signal) => {
                    await api.invite(
                      w,
                      { email: email.trim(), role: "member" },
                      signal,
                    );
                    if (!signal.aborted) {
                      setEmail("");
                      task.setStatus(
                        "Pending membership invitation recorded. It is claimed by the verified matching Supabase email on sign-in. No invitation-email delivery was claimed.",
                      );
                    }
                  });
                }}
              >
                <label className="field">
                  Invite member email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <Button disabled={task.busy}>Record member invitation</Button>
              </form>
            )}
            <p>
              Owners manage knowledge, checks, releases and billing. Members
              inspect, preview, give feedback and request handoff. The backend
              enforces these permissions.
            </p>
          </section>
          <section className="panel stack-form">
            <h2>Usage & billing</h2>
            <ErrorNotice error={usage.error} retry={usage.reload} />
            {usage.loading && !usage.data && <Loading />}
            {usage.data && (
              <>
                <p>
                  Plan {usage.data.plan} · subscription status{" "}
                  {usage.data.status}
                </p>
                <p>
                  Usage period {formatDate(usage.data.periodStart)} —{" "}
                  {formatDate(usage.data.periodEnd)} UTC. This period end is not
                  a guaranteed renewal date.
                </p>
                <dl className="metadata-list">
                  <dt>Replies used / reserved / limit</dt>
                  <dd>
                    {usage.data.used.reply} / {usage.data.reserved.reply} /{" "}
                    {usage.data.limits.replies}
                  </dd>
                  <dt>Checks used / reserved / limit</dt>
                  <dd>
                    {usage.data.used.check} / {usage.data.reserved.check} /{" "}
                    {usage.data.limits.checks}
                  </dd>
                  <dt>OCR used / reserved / limit</dt>
                  <dd>
                    {usage.data.used.ocr} / {usage.data.reserved.ocr} /{" "}
                    {usage.data.limits.ocrPages}
                  </dd>
                  <dt>Source page allowance</dt>
                  <dd>
                    {usage.data.limits.sourcePages} (indexed usage count is not
                    supplied)
                  </dd>
                  <dt>Spend / reserved / cap</dt>
                  <dd>
                    ${(usage.data.spentMicros / 1000000).toFixed(2)} / $
                    {(usage.data.reservedMicros / 1000000).toFixed(2)} / $
                    {(usage.data.monthlySpendLimitMicros / 1000000).toFixed(2)}
                  </dd>
                </dl>
              </>
            )}
            {owner && (
              <>
                <label className="field">
                  Checkout plan
                  <select
                    value={plan}
                    onChange={(e) => setPlan(e.target.value as typeof plan)}
                  >
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                  </select>
                </label>
                <Button
                  disabled={task.busy}
                  onClick={() =>
                    task.run(async (signal) => {
                      const link = await api.checkout(w, { plan }, signal);
                      const url = safeUrl(link.url);
                      if (!url)
                        throw new Error(
                          "The backend returned an invalid checkout URL.",
                        );
                      if (!signal.aborted) location.assign(url);
                    })
                  }
                >
                  Open secure checkout
                </Button>
                <Button
                  variant="secondary"
                  disabled={task.busy}
                  onClick={() =>
                    task.run(async (signal) => {
                      const link = await api.portal(w, signal);
                      const url = safeUrl(link.url);
                      if (!url)
                        throw new Error(
                          "The backend returned an invalid billing portal URL.",
                        );
                      if (!signal.aborted) location.assign(url);
                    })
                  }
                >
                  Open billing portal
                </Button>
              </>
            )}
            <p>
              Subscription changes are reflected only after the backend receives
              payment-provider events. No simulated payments, auto-purchases, or
              subscription changes.
            </p>
          </section>
          <LegacyDataExport />
        </div>
      </div>
    </div>
  );
}
