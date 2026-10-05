/** Server transport only. Imported by the Next route, never by browser code. */
export async function forwardRequest(
  request: Request,
  path: string[],
  backendOrigin: string,
) {
  const failure = (status: number, code: string, message: string) =>
    Response.json(
      { error: { code, message }, requestId: crypto.randomUUID() },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  if (
    !path.length ||
    !["bootstrap", "workspaces", "public"].includes(path[0]) ||
    path.some((p) => !p || p === "." || p === ".." || /[\\/\u0000]/.test(p))
  )
    return failure(
      400,
      "INVALID_PATH",
      "This API path is not available through the frontend.",
    );
  let origin: URL;
  try {
    origin = new URL(backendOrigin);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    )
      throw new Error();
  } catch {
    return failure(
      503,
      "CONFIGURATION_ERROR",
      "Configure the server-only BACKEND_API_ORIGIN before connecting to the API.",
    );
  }
  const headers = new Headers();
  for (const key of [
    "authorization",
    "content-type",
    "idempotency-key",
    "if-match",
    "accept",
  ]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  let incomingOrigin = request.headers.get("origin");
  if (!incomingOrigin && path[0] === "public") {
    try {
      incomingOrigin = new URL(request.headers.get("referer") || request.url)
        .origin;
    } catch {
      return failure(
        400,
        "INVALID_ORIGIN",
        "A valid hosted iframe origin is required.",
      );
    }
  }
  if (incomingOrigin) {
    try {
      const url = new URL(incomingOrigin);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.origin !== incomingOrigin
      )
        throw new Error();
      headers.set("Origin", url.origin);
    } catch {
      return failure(
        400,
        "INVALID_ORIGIN",
        "Provide a valid installation origin.",
      );
    }
  }
  const target = new URL(
    `/api/v1/${path.map(encodeURIComponent).join("/")}`,
    origin,
  );
  target.search = new URL(request.url).search;
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = request.body;
      init.duplex = "half";
    }
    const response = await fetch(target, init);
    if (response.status >= 300 && response.status < 400)
      return failure(
        502,
        "UPSTREAM_REDIRECT",
        "The API unexpectedly redirected. The request was not repeated.",
      );
    const output = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const key of [
      "content-type",
      "content-disposition",
      "retry-after",
      "etag",
      "x-request-id",
    ]) {
      const value = response.headers.get(key);
      if (value) output.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: output,
    });
  } catch {
    return failure(
      503,
      "BACKEND_UNAVAILABLE",
      "The backend could not be reached. A submitted operation may still be running; inspect its state before retrying.",
    );
  }
}
