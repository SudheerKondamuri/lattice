"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Blocks,
  BookOpen,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  Menu,
  MessageSquare,
  Settings2,
} from "lucide-react";
import { Brand } from "./brand";
import { Modal } from "./ui";
import { useWorkspace, useWorkspaceHref } from "@/lib/store";
import { browserAuth } from "@/lib/supabase-browser";
import { useTask } from "@/lib/resources";
import { TaskNotice } from "./async-state";
const navigation = [
  { href: "/app", label: "Overview", icon: LayoutGrid },
  { href: "/app/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/app/playground", label: "Playground", icon: FlaskConical },
  { href: "/app/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/app/compare", label: "Compare & Check", icon: Blocks },
  { href: "/app/releases", label: "Releases", icon: GitBranch },
  { href: "/app/settings", label: "Settings", icon: Settings2 },
];
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    href = useWorkspaceHref();
  const { bootstrap, detail, workspaceId, selectWorkspace } = useWorkspace();
  const [mobile, setMobile] = useState(false);
  const task = useTask(workspaceId);
  useEffect(() => {
    setMobile(false);
  }, [path, workspaceId]);
  if (!detail) return null;
  const title =
    navigation.find((item) => item.href === path)?.label ?? "Workspace";
  const controls = (
    <>
      <div className="sidebar-brand">
        <Brand />
      </div>
      <label className="field workspace-selector">
        Workspace
        <select
          aria-label="Workspace"
          value={workspaceId}
          onChange={(e) => selectWorkspace(e.target.value)}
        >
          {bootstrap.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.role}
            </option>
          ))}
        </select>
      </label>
      <nav aria-label="Workspace navigation">
        {navigation.map(({ href: destination, label, icon: Icon }) => (
          <Link
            key={destination}
            href={href(destination)}
            className={`nav-item ${path === destination ? "active" : ""}`}
            aria-current={path === destination ? "page" : undefined}
            onClick={() => setMobile(false)}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-lower">
        <Link href="/onboarding" className="nav-item">
          Create a workspace
        </Link>
        <div className="sidebar-user">
          <span className="user-avatar">
            {bootstrap.user.email.charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{bootstrap.user.email}</strong>
            <small>{detail.workspace.role}</small>
          </div>
        </div>
        <button
          className="nav-item"
          disabled={task.busy}
          onClick={() =>
            task.run(async () => {
              const { error } = await browserAuth().auth.signOut();
              if (error) throw error;
            })
          }
        >
          Sign out
        </button>
      </div>
    </>
  );
  return (
    <div className="workspace">
      <aside className="sidebar desktop-sidebar" aria-label="Workspace controls">{controls}</aside>
      <div className="workspace-body">
        <header className="app-topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
              aria-expanded={mobile}
              aria-controls="mobile-navigation"
            >
              <Menu size={19} />
            </button>
            <span>{detail.workspace.name}</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="preview-label">
              {detail.agent.publishedReleaseId ? "PUBLISHED" : "NOT PUBLISHED"}
            </span>
            <Link href={href("/app/playground")} className="topbar-preview">
              Preview agent <ArrowUpRight size={14} />
            </Link>
            {detail.workspace.role === "owner" && (
              <Link
                href={href("/app/releases")}
                className="button button-small button-primary"
              >
                Review & publish
              </Link>
            )}
          </div>
        </header>
        <main id="main-content" className="app-content">
          <TaskNotice task={task} />
          {children}
        </main>
        <footer className="app-footer">
          <span>Server-backed workspace · {detail.workspace.role}</span>
          <span>KNOWLEDGE → CLARITY</span>
        </footer>
      </div>
      <Modal
        open={mobile}
        onClose={() => setMobile(false)}
        title="Workspace navigation"
      >
        <div id="mobile-navigation" className="mobile-navigation">
          {controls}
        </div>
      </Modal>
    </div>
  );
}
