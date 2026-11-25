// Server-side Cloudflare Turnstile verification, shared by the public
// endpoints that take a token (POST /api/submissions, POST /api/menu-photo).
// Tokens are single-use: each request needs a freshly minted one.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Server-side Turnstile check. Besides `success`, the token must have been
 * solved on the host this request arrived at, so a token minted on another
 * site that embeds our sitekey can't be replayed here. Loopback hosts skip the
 * hostname match: Cloudflare's test keys report a placeholder hostname.
 * Failures are logged (Pages real-time logs) so a rotated or broken secret
 * shows up as `turnstile siteverify failed` instead of a silently dead form.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string,
  expectedHost: string,
): Promise<boolean> {
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  form.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json<{ success?: boolean; hostname?: string; "error-codes"?: string[] }>();
    if (data.success !== true) {
      console.warn("turnstile siteverify failed", data["error-codes"] ?? []);
      return false;
    }
    if (!LOOPBACK_HOSTS.has(expectedHost) && data.hostname !== expectedHost) {
      console.warn("turnstile hostname mismatch", { got: data.hostname, expected: expectedHost });
      return false;
    }
    return true;
  } catch (err) {
    console.error("turnstile siteverify unreachable", err);
    return false;
  }
}
