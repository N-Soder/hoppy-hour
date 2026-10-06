// Fixed-window per-IP rate limiter backed by KV. Keyed on CF-Connecting-IP
// (Cloudflare-set, not client-spoofable). Fails OPEN on any KV error — a lax
// limiter beats a 500 for a legitimate user, and Turnstile independently gates
// the one endpoint that matters most (submissions).
export async function rateLimit(
  kv: KVNamespace,
  bucket: string,
  ip: string,
  max: number,
): Promise<boolean> {
  const window = Math.floor(Date.now() / 60_000); // current minute
  const key = `rl:${bucket}:${ip}:${window}`;
  try {
    const count = parseInt((await kv.get(key)) ?? "0", 10);
    if (count >= max) return false;
    // 60s is KV's minimum expirationTtl — exactly one window.
    await kv.put(key, String(count + 1), { expirationTtl: 60 });
    return true;
  } catch {
    // Quota exhausted, or KV's ~1-write/sec-per-key cap hit by two same-second
    // requests from one IP. Allow the request rather than error.
    return true;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
