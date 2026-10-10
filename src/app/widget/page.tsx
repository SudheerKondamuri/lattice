import { Widget } from "@/widget/widget";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ agent?: string; site?: string }> }) { const params = await searchParams; return <Widget agentId={params.agent ?? ""} site={params.site ?? ""}/>; }
