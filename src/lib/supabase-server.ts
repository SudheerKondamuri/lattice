import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export async function serverAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Refresh writes are performed by proxy. */
        }
      },
    },
  });
}
export async function requireUser() {
  const auth = await serverAuth();
  const result = auth ? await auth.auth.getUser() : null;
  if (!result?.data.user) redirect("/auth/sign-in");
  return result.data.user;
}
