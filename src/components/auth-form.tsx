"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authConfigured, browserAuth } from "@/lib/supabase-browser";
import { Button } from "./ui";
import { Brand } from "./brand";
import { LegacyDataExport } from "./legacy-export";

export function AuthForm({
  mode,
}: {
  mode: "sign-in" | "sign-up" | "recover" | "update-password";
}) {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState("");
  const titles = {
    "sign-in": "Welcome back.",
    "sign-up": "Give your knowledge a home.",
    recover: "Recover your password.",
    "update-password": "Choose a new password.",
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setReceipt("");
    try {
      const auth = browserAuth();
      if (mode === "sign-in") {
        const result = await auth.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (result.error) throw result.error;
        if (!result.data.session)
          throw new Error(
            "No session returned. Verify your email before signing in.",
          );
        router.replace("/app");
        router.refresh();
      }
      if (mode === "sign-up") {
        const result = await auth.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (result.error) throw result.error;
        if (result.data.session) {
          router.replace("/onboarding");
          router.refresh();
        } else
          setReceipt(
            "Sign-up request accepted. Check your email for a verification link. You can sign in after verifying.",
          );
      }
      if (mode === "recover") {
        const result = await auth.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${location.origin}/auth/callback?next=/auth/update-password`,
        });
        if (result.error) throw result.error;
        setReceipt(
          "Recovery request accepted. If this address has an account, check its inbox. Email delivery has not been verified here.",
        );
      }
      if (mode === "update-password") {
        const user = await auth.auth.getUser();
        if (user.error || !user.data.user)
          throw new Error(
            "This recovery session has expired. Request another recovery link.",
          );
        const result = await auth.auth.updateUser({ password });
        if (result.error) throw result.error;
        setReceipt(
          "Password updated by Supabase. You can return to your workspace.",
        );
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main-content" className="auth-shell">
      <div className="auth-card">
        <Brand />
        <div className="eyebrow">A LITTLE GROUNDWORK</div>
        <h1>{titles[mode]}</h1>
        <p>
          Real accounts. Workspace-scoped knowledge. Nothing uploaded from your
          old preview automatically.
        </p>
        {!authConfigured() && (
          <div className="state-notice state-error" role="alert">
            Authentication unavailable. Configure NEXT_PUBLIC_SUPABASE_URL and
            NEXT_PUBLIC_SUPABASE_ANON_KEY.
          </div>
        )}
        <form onSubmit={submit} className="stack-form">
          {mode !== "update-password" && (
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
              />
            </label>
          )}
          {mode !== "recover" && (
            <label className="field">
              Password
              <input
                type="password"
                required
                minLength={mode === "sign-in" ? 1 : 8}
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {receipt && (
            <p className="state-notice" role="status">
              {receipt}
            </p>
          )}
          <Button disabled={busy || !authConfigured()}>
            {busy
              ? "Waiting for Supabase…"
              : mode === "sign-in"
                ? "Sign in"
                : mode === "sign-up"
                  ? "Create account"
                  : mode === "recover"
                    ? "Send recovery link"
                    : "Update password"}
          </Button>
        </form>
        <div className="auth-links">
          <Link href="/auth/sign-in">Sign in</Link>
          <Link href="/auth/sign-up">Create account</Link>
          <Link href="/auth/recover">Forgot password?</Link>
          {receipt && mode === "update-password" && (
            <Link href="/app">Open workspace</Link>
          )}
        </div>
        <LegacyDataExport />
      </div>
    </main>
  );
}
