import { WorkspaceProvider } from "@/lib/store";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireUser } from "@/lib/supabase-server";
import { Suspense } from "react";
export const dynamic = "force-dynamic";
export default async function AppLayout({ children }: { children: React.ReactNode }) { await requireUser(); return <Suspense fallback={<p role="status">Loading workspace…</p>}><WorkspaceProvider><WorkspaceShell>{children}</WorkspaceShell></WorkspaceProvider></Suspense>; }
