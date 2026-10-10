import { redirect } from "next/navigation";
/** Compatibility for backend billing return URLs; never infers payment success. */
export default async function Page({ searchParams }: { searchParams: Promise<{ workspace?: string; billing?: string }> }) {
  const values = await searchParams; const query = new URLSearchParams(); if (values.workspace) query.set("workspace", values.workspace); if (values.billing) query.set("billing", values.billing);
  redirect(`/app/settings?${query}`);
}
