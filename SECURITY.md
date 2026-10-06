# Security policy

## Reporting a vulnerability

Please **do not** report security issues in public GitHub issues, pull requests
or discussions.

Report them privately through GitHub's
[private vulnerability reporting](https://github.com/N-Soder/hoppy-hour/security/advisories/new)
(**Security → Report a vulnerability** on the repository page). Please include:

- a description of the issue and its impact
- steps to reproduce, or a proof of concept
- any affected endpoints, files or versions

You should get an acknowledgement within a few days. Please give us a reasonable
amount of time to fix the issue before disclosing it publicly.

## Scope

In scope: the code in this repository, including the Cloudflare Pages Functions
under `functions/` and the React app under `src/`.

Out of scope: third-party services (Mapbox, Cloudflare, Anthropic), and
findings that need a compromised Cloudflare account or admin session.

## Security model (summary)

- `/api/admin/*` is protected at the edge by **Cloudflare Access**. The Functions
  middleware also verifies the signed Access JWT (issuer + audience) and rejects
  cross-site state-changing requests.
- Public submissions go through a honeypot, per-IP rate limiting (KV) and
  **Cloudflare Turnstile**, then server-side validation, before they land in a
  moderation queue. Nothing a visitor submits goes live without admin approval.
- Secrets (Mapbox token, Turnstile secret, Anthropic API key) are Cloudflare
  Pages secrets and are never committed. The Mapbox token is intentionally
  public (Mapbox GL JS needs it in the browser), so restrict it to your own
  URLs in the Mapbox dashboard.
