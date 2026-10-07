import { serverAuth } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
export async function GET(request: Request) {
  const url = new URL(request.url),
    auth = await serverAuth();
  const code = url.searchParams.get("code"),
    hash = url.searchParams.get("token_hash"),
    type = url.searchParams.get("type");
  let error = "The verification or recovery link is missing or expired.";
  if (auth) {
    const result = code
      ? await auth.auth.exchangeCodeForSession(code)
      : hash &&
          type &&
          [
            "email",
            "signup",
            "recovery",
            "invite",
            "magiclink",
            "email_change",
          ].includes(type)
        ? await auth.auth.verifyOtp({
            token_hash: hash,
            type: type as EmailOtpType,
          })
        : null;
    if (result && !result.error)
      return new NextResponse(null, {
        status: 303,
        headers: {
          Location:
            url.searchParams.get("next") === "/auth/update-password" ||
            type === "recovery"
              ? "/auth/update-password"
              : "/onboarding",
        },
      });
    if (result?.error) error = result.error.message;
  } else error = "Authentication is not configured.";
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `/auth/verify?error=${encodeURIComponent(error)}` },
  });
}
