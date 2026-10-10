import { WorkspaceProvider } from "@/lib/store";
import { Playground } from "@/components/pages/playground";
import { requireUser } from "@/lib/supabase-server";
import { Suspense } from "react";
export const dynamic = "force-dynamic";
export default async function Page() { await requireUser(); return <Suspense><WorkspaceProvider><main id="main-content" className="standalone-preview"><Playground embedded/></main></WorkspaceProvider></Suspense>; }
