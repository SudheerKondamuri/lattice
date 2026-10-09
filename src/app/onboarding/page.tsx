import { Suspense } from "react";
import { requireUser } from "@/lib/supabase-server";
import { WorkspaceProvider } from "@/lib/store";
import { Onboarding } from "@/components/pages/onboarding";
export const dynamic = "force-dynamic";
export default async function Page() { await requireUser(); return <Suspense><WorkspaceProvider onboarding><Onboarding/></WorkspaceProvider></Suspense>; }
