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
 * Read and JSON-parse a request body, returning null on any parse failure or
 * when the body exceeds maxBytes (so oversized payloads are never parsed).
 */
export async function readJson<T>(request: Request, maxBytes = 256 * 1024): Promise<T | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
