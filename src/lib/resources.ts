"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, type ApiClient } from "./api";
export function useResource<T>(
  api: ApiClient,
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const loader = useRef(load);
  loader.current = load;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    api: ApiClient;
    key: string | null;
    data?: T;
    error?: unknown;
    loading: boolean;
  }>({ api, key, loading: true });
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(
    () =>
      api.subscribe((prefix) => {
        if (key?.startsWith(prefix)) reload();
      }),
    [api, key, reload],
  );
  useEffect(() => {
    const controller = new AbortController();
    setResult((previous) => ({
      api,
      key,
      loading: !!key,
      ...(previous.api === api && previous.key === key
        ? { data: previous.data }
        : {}),
    }));
    if (key)
      loader.current(controller.signal).then(
        (data) => {
          if (!controller.signal.aborted)
            setResult({ api, key, data, loading: false });
        },
        (error) => {
          if (!controller.signal.aborted)
            setResult((previous) => ({
              api,
              key,
              error,
              loading: false,
              ...(previous.api === api &&
              previous.key === key &&
              !(
                error instanceof ApiFailure && [401, 403].includes(error.status)
              )
                ? { data: previous.data }
                : {}),
            }));
        },
      );
    return () => controller.abort();
  }, [api, key, revision]);
  // A changed tenant/key never renders the previous tenant's data, even for one frame.
  return {
    ...(result.api === api && result.key === key
      ? result
      : { api, key, data: undefined, error: undefined, loading: !!key }),
    reload,
  };
}
export function useTask(scope: string) {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [status, setStatus] = useState("");
  useEffect(() => {
    setBusy(false);
    setError(null);
    setStatus("");
    return () => controller.current?.abort();
  }, [scope]);
  async function run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    if (controller.current && !controller.current.signal.aborted) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      const value = await operation(current.signal);
      return current.signal.aborted ? undefined : value;
    } catch (error) {
      if (!current.signal.aborted) setError(error);
    } finally {
      if (!current.signal.aborted) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setStatus(
      "Stopped waiting. An accepted server job has not been cancelled; inspect its status before resubmitting.",
    );
  }
  return { busy, error, status, run, setStatus, setError, cancel };
}
