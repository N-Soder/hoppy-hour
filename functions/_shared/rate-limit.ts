// Fixed-window per-IP rate limiter backed by KV. Keyed on CF-Connecting-IP
// (Cloudflare-set, not client-spoofable).
//
// `rateLimit` fails OPEN on any KV error — a lax limiter beats a 500 for a
// legitimate user, and Turnstile independently gates submissions. Cost guards
// that must fail CLOSED (the public photo read) use `rateLimitStatus` and the
// daily-cap helpers, which report KV failures as "error" instead.
//
// KV has no atomic increment: two requests landing in the same instant can
// both read N and both write N+1, so a burst can slip a request or two past
// the limit. That is accepted here — these limits are cost/abuse guards, not
// exact quotas.

export type RateWindow = "minute" | "hour" | "day";

/** "ok" (counted, allowed), "limited", or "error" (KV unreachable or refused). */
export type LimitStatus = "ok" | "limited" | "error";

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

async function countOne(kv: KVNamespace, key: string, max: number, ttl: number): Promise<LimitStatus> {
  try {
    const n = parseInt((await kv.get(key)) ?? "0", 10);
    if (n >= max) return "limited";
    await kv.put(key, String(n + 1), { expirationTtl: ttl });
    return "ok";
  } catch {
    // Quota exhausted, KV unreachable, or KV's ~1-write/sec-per-key cap hit by
    // two same-second requests on one key.
    return "error";
  }
}

/**
 * Count one request against `bucket` for `ip` and report the outcome,
 * including KV failures. "hour" and "day" are fixed UTC windows (day = UTC
 * calendar day); the TTL is exactly one window (60s is KV's minimum).
 */
export function rateLimitStatus(
  kv: KVNamespace,
  bucket: string,
  ip: string,
  max: number,
  window: RateWindow = "minute",
): Promise<LimitStatus> {
  return countOne(kv, windowKey(bucket, ip, window, Date.now()), max, WINDOW_SECONDS[window]);
}

/**
 * Count one request and say whether it is allowed. Fails OPEN on KV errors.
 * `window` defaults to the original per-minute behaviour.
 */
export async function rateLimit(
  kv: KVNamespace,
  bucket: string,
  ip: string,
  max: number,
  window: RateWindow = "minute",
): Promise<boolean> {
  return (await rateLimitStatus(kv, bucket, ip, max, window)) !== "limited";
}

/** UTC calendar date, YYYY-MM-DD. */
export function utcDate(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Site-wide daily cap: one shared counter per UTC date, for spend that must
 * stay bounded no matter how many IPs are involved. Reports KV failures as
 * "error" so the caller can fail closed.
 *
 * `peekDailyCap` only reads (used up front so a paused feature answers before
 * any other work); `takeDailyCap` counts one use. Not atomic (see above), so a
 * same-second burst can overshoot the cap slightly.
 */
export async function peekDailyCap(kv: KVNamespace, name: string, max: number): Promise<LimitStatus> {
  try {
    const n = parseInt((await kv.get(`cap:${name}:${utcDate()}`)) ?? "0", 10);
    return n < max ? "ok" : "limited";
  } catch {
    return "error";
  }
}

export function takeDailyCap(kv: KVNamespace, name: string, max: number): Promise<LimitStatus> {
  // Two days so the key outlives the whole UTC day it counts.
  return countOne(kv, `cap:${name}:${utcDate()}`, max, 2 * 24 * 60 * 60);
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
