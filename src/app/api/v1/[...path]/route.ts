import "server-only";
import { forwardRequest } from "@/lib/forward";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) { return forwardRequest(request, (await context.params).path, process.env.BACKEND_API_ORIGIN ?? ""); }
export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE, handler as HEAD };
