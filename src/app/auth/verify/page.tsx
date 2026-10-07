import Link from "next/link";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main id="main-content" className="auth-shell">
      <section className="auth-card">
        <h1>Verify your email.</h1>
        <p role={error ? "alert" : "status"}>
          {error ||
            "Open the verification link sent by Supabase, then sign in. No account or workspace has been created by this page."}
        </p>
        <Link className="button button-primary" href="/auth/sign-in">
          Return to sign in
        </Link>
        <Link className="button button-secondary" href="/auth/recover">
          Request recovery link
        </Link>
      </section>
    </main>
  );
}
