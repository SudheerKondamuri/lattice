"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiClient } from "./api";
import { browserAuth } from "./supabase-browser";
import { useResource } from "./resources";
import { ErrorNotice, Loading } from "@/components/async-state";
import type { Bootstrap, WorkspaceDetail } from "@/contracts/api";

type Context = {
  api: ApiClient;
  bootstrap: Bootstrap;
  detail: WorkspaceDetail | null;
  workspaceId: string;
  owner: boolean;
  selectWorkspace: (id: string) => void;
  refresh: () => void;
};
const WorkspaceContext = createContext<Context | null>(null);
export function WorkspaceProvider({
  children,
  onboarding = false,
}: {
  children: ReactNode;
  onboarding?: boolean;
}) {
  const router = useRouter(),
    params = useSearchParams();
  const [authRevision, setAuthRevision] = useState(0);
  const api = useMemo(
    () =>
      new ApiClient(async () => {
        const { data, error } = await browserAuth().auth.getSession();
        if (error) throw error;
        return data.session?.access_token ?? null;
      }),
    [authRevision],
  );
  const bootstrap = useResource(api, "/bootstrap", (s) => api.bootstrap(s));
  // Never silently show another tenant when an explicit URL workspace is inaccessible.
  const workspaceId =
    params.get("workspace") || bootstrap.data?.workspaces[0]?.id || "";
  const detail = useResource(
    api,
    workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}` : null,
    (s) => api.workspace(workspaceId, s),
  );
  useEffect(() => {
    const { data } = browserAuth().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setAuthRevision((r) => r + 1);
        router.replace("/auth/sign-in");
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED")
        setAuthRevision((r) => r + 1);
    });
    return () => data.subscription.unsubscribe();
  }, [router]);
  useEffect(() => {
    if (bootstrap.data && !workspaceId && !onboarding)
      router.replace("/onboarding");
  }, [bootstrap.data, workspaceId, onboarding, router]);
  if (
    (bootstrap.loading && !bootstrap.data) ||
    (!onboarding && detail.loading && !detail.data)
  )
    return (
      <main id="main-content" className="auth-shell">
        <Loading />
      </main>
    );
  if ((bootstrap.error && !bootstrap.data) || (detail.error && !detail.data))
    return (
      <main id="main-content" className="auth-shell">
        <ErrorNotice
          error={bootstrap.error || detail.error}
          retry={() => {
            bootstrap.reload();
            detail.reload();
          }}
        />
      </main>
    );
  if (!bootstrap.data || (!onboarding && !detail.data))
    return (
      <main id="main-content" className="auth-shell">
        <Loading label="Preparing your workspace…" />
      </main>
    );
  function selectWorkspace(id: string) {
    router.push(`/app?workspace=${encodeURIComponent(id)}`);
  }
  return (
    <WorkspaceContext.Provider
      value={{
        api,
        bootstrap: bootstrap.data,
        detail: detail.data ?? null,
        workspaceId,
        owner: detail.data?.workspace.role === "owner",
        selectWorkspace,
        refresh: () => {
          bootstrap.reload();
          detail.reload();
        },
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider required");
  return value;
}
export function useWorkspaceHref() {
  const { workspaceId } = useWorkspace();
  return (path: string) =>
    `${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(workspaceId)}`;
}
