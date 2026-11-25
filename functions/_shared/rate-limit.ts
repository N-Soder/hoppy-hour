// Fixed-window per-IP rate limiter backed by KV. Keyed on CF-Connecting-IP
// (Cloudflare-set, not client-spoofable). Fails OPEN on any KV error — a lax
// limiter beats a 500 for a legitimate user, and Turnstile independently gates
// the endpoints that matter most (submissions, photo reads).
//
// KV has no atomic increment: two requests landing in the same instant can
// both read N and both write N+1, so a burst can slip a request or two past
// the limit. That is accepted here — these limits are cost/abuse guards, not
// exact quotas.

export type RateWindow = "minute" | "hour" | "day";

const WINDOW_SECONDS: Record<RateWindow, number> = {
  minute: 60,
  hour: 60 * 60,
  day: 24 * 60 * 60,
};

/** Key for the current window. Minute keys keep their original shape. */
function windowKey(bucket: string, ip: string, window: RateWindow, now: number): string {
  const n = Math.floor(now / (WINDOW_SECONDS[window] * 1000));
  return window === "minute" ? `rl:${bucket}:${ip}:${n}` : `rl:${bucket}:${window}:${ip}:${n}`;
}

/**
 * Count one request against `bucket` for `ip` and say whether it is allowed.
 * `window` defaults to the original per-minute behaviour; "hour" and "day" are
 * fixed UTC windows (day = UTC calendar day).
 */
export async function rateLimit(
  kv: KVNamespace,
  bucket: string,
  ip: string,
  max: number,
  window: RateWindow = "minute",
): Promise<boolean> {
  const key = windowKey(bucket, ip, window, Date.now());
  try {
    const count = parseInt((await kv.get(key)) ?? "0", 10);
    if (count >= max) return false;
    // TTL is exactly one window (60s is also KV's minimum expirationTtl).
    await kv.put(key, String(count + 1), { expirationTtl: WINDOW_SECONDS[window] });
    return true;
  } catch {
    // Quota exhausted, or KV's ~1-write/sec-per-key cap hit by two same-second
    // requests from one IP. Allow the request rather than error.
    return true;
  }
}

/** UTC calendar date, YYYY-MM-DD. */
export function utcDate(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Site-wide daily cap: one shared counter per UTC date, for spend that must
 * stay bounded no matter how many IPs are involved.
 *
 * `peekDailyCap` only reads (used up front so a paused feature answers before
 * any other work); `takeDailyCap` counts one use. Same KV caveats as above:
 * not atomic, and it fails open on KV errors, so a same-second burst can
 * overshoot the cap slightly.
 */
export async function peekDailyCap(kv: KVNamespace, name: string, max: number): Promise<boolean> {
  try {
    const count = parseInt((await kv.get(`cap:${name}:${utcDate()}`)) ?? "0", 10);
    return count < max;
  } catch {
    return true;
  }
}

export async function takeDailyCap(kv: KVNamespace, name: string, max: number): Promise<boolean> {
  const key = `cap:${name}:${utcDate()}`;
  try {
    const count = parseInt((await kv.get(key)) ?? "0", 10);
    if (count >= max) return false;
    // Two days so the key outlives the whole UTC day it counts.
    await kv.put(key, String(count + 1), { expirationTtl: 2 * 24 * 60 * 60 });
    return true;
  } catch {
    return true;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
