"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useWorkspace } from "@/lib/store";
import { useTask } from "@/lib/resources";
import { TaskNotice } from "../async-state";
import { Brand } from "../brand";
import { Button } from "../ui";
import type { WorkspaceDetail } from "@/contracts/api";
export function Onboarding() {
  const { api, bootstrap, refresh } = useWorkspace();
  const [name, setName] = useState(""),
    [agentName, setAgentName] = useState(""),
    [email, setEmail] = useState(bootstrap.user.email),
    [website, setWebsite] = useState("");
  const [created, setCreated] = useState<WorkspaceDetail | null>(null);
  const task = useTask("onboarding");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agentName.trim() || !email.trim()) {
      task.setError(
        new Error("Business, agent, and support email are required."),
      );
      return;
    }
    await task.run(async (signal) => {
      const data = await api.createWorkspace(
        {
          name: name.trim(),
          agentName: agentName.trim(),
          supportEmail: email.trim(),
          ...(website ? { websiteUrl: website.trim() } : {}),
        },
        signal,
      );
      if (!signal.aborted) {
        setCreated(data);
        refresh();
        task.setStatus(
          "Workspace and draft agent created by the API. Add knowledge and review a release before deploying.",
        );
      }
    });
  }
  return (
    <main id="main-content" className="auth-shell">
      <section className="auth-card">
        <Brand />
        <h1>A little groundwork.</h1>
        <p>
          Create a real workspace and one draft agent. Only the backend assigns
          workspace and agent IDs.
        </p>
        <TaskNotice task={task} />
        {created ? (
          <Link
            className="button button-primary"
            href={`/app/knowledge?workspace=${encodeURIComponent(created.workspace.id)}&import=1`}
          >
            Add your first source
          </Link>
        ) : (
          <form className="stack-form" onSubmit={submit}>
            <label className="field">
              Business name
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              Agent name
              <input
                required
                maxLength={120}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
              />
            </label>
            <label className="field">
              Support email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              Website (optional)
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yourcompany.com"
              />
            </label>
            <Button disabled={task.busy}>Create workspace & agent</Button>
          </form>
        )}
        {bootstrap.workspaces.length > 0 && (
          <Link className="subtle-link" href="/app">
            Return to existing workspace
          </Link>
        )}
      </section>
    </main>
  );
}
