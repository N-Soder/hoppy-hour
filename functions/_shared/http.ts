// Small JSON response helpers shared by all Functions.

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

/**
 * Read and JSON-parse a request body, returning null on any parse failure, a
 * non-JSON Content-Type, or when the body exceeds maxBytes (so oversized
 * payloads are never parsed).
 *
 * Requiring application/json is a CSRF backstop: a cross-site page can only
 * send that type after a CORS preflight, which these same-origin Functions
 * never approve. text/plain "simple" requests skip the preflight.
 */
export async function readJson<T>(request: Request, maxBytes = 256 * 1024): Promise<T | null> {
  const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return null;
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
