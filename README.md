# HoppyHour

A community-driven web app for discovering happy hour deals at bars and restaurants near you.

## Overview

HoppyHour lets users find venues with active happy hours based on their current location, time, and day. Venues are shown on an interactive map and filterable list. Anyone can submit a new happy hour deal; submissions go into a moderation queue managed through the admin panel.

**Key features:**
- Location-aware venue discovery with geospatial radius search
- Real-time filtering by time, day, radius, and drink/food tags
- Interactive Mapbox map with list view toggle
- Community submission form with honeypot, rate-limit and Turnstile anti-bot protection
- Admin dashboard for managing venues, happy hours, and the submission queue
- Mobile-responsive layout with map/list toggle

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Browser (React SPA)                │
│                                                     │
│  pages/          components/         hooks/         │
│  ├─ Index        ├─ MapView          ├─ use-venues  │
│  ├─ Submit       ├─ FiltersPanel     ├─ use-geoloc  │
│  └─ Admin        ├─ VenueList        └─ ...         │
│                  └─ VenueDetailModal                │
│                                                     │
│  TanStack Query (data fetching & caching)           │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS
           ┌─────────▼──────────┐
           │  Cloudflare Pages   │
           │                    │
           │  D1 (SQLite)        │
           │  ← bounding-box     │
           │    prefilter +      │
           │    haversine in JS  │
           │                    │
           │  Pages Functions     │  ← /api/*
           │  ├─ venues, geo,     │
           │  │  geocode,         │
           │  │  mapbox-token,    │
           │  │  submissions      │
           │  └─ admin/* (behind  │
           │     Cloudflare       │
           │     Access)          │
           │                    │
           │  R2 (submission      │
           │  photos) + KV         │
           │  (rate limiting)      │
           └────────────────────┘
```

### Frontend

Built as a single-page React app, deployed to **Cloudflare Pages**.

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| Routing | React Router 6 |
| Data fetching | TanStack Query 5 |
| Styling | Tailwind CSS + shadcn/ui |
| Maps | Mapbox GL JS |
| Forms | React Hook Form + Zod |

**Page structure:**

- `Index` — main discovery page: runs geolocation, fetches venues within radius, renders `MapView` and `VenueList` side by side (or toggled on mobile)
- `Submit` — public form for submitting new happy hour deals
- `Admin` — dashboard for approving submissions and managing data, gated at the edge by Cloudflare Access (no in-app login)

**Data flow:** custom hooks in `src/hooks/` call the same-origin `/api` Pages Functions (via `src/lib/api.ts`) through TanStack Query. `use-venues.ts` calls `GET /api/venues`, which does an indexed bounding-box prefilter on `lat`/`lng` in D1 followed by an exact haversine distance calculation and sort in the Function. Results are filtered client-side by the selected day/time/tags.

### Backend

Hosted entirely on **Cloudflare** — Pages, Pages Functions, D1, KV, and R2.

**Database tables (D1 / SQLite, see `db/schema.sql`):**

| Table | Purpose |
|---|---|
| `venues` | Location, address, lat/lng, status |
| `happy_hours` | Day(s), start/end time, tags, description, active flag |
| `submissions` | User-submitted deals pending moderation |

**Key API routes** (`functions/api/`, deployed with the Pages build):

- `venues` — bounding-box + haversine proximity search, returns venues with their active happy hours in one round trip
- `geo` — best-effort visitor country from Cloudflare's edge (`cf-ipcountry`), used to prefill the submit form
- `geocode` — rate-limited Mapbox geocoding proxy
- `mapbox-token` — serves the public Mapbox token to the browser (its abuse control is the token's URL restriction in the Mapbox dashboard)
- `submissions` — public submission intake (honeypot + Turnstile anti-bot)
- `admin/*` — venue/happy-hour management and submission moderation, including Snap-a-Deal photo intake (R2 + Anthropic vision extraction)

**Auth & access control:** `/admin` and `/api/admin/*` sit behind **Cloudflare Access**; `functions/api/admin/_middleware.ts` independently verifies the signed `Cf-Access-Jwt-Assertion` JWT (issuer + audience) and rejects cross-site writes as defence-in-depth.

---

## Local Development

**Requirements:** Node.js 22+ and npm. A free [Mapbox](https://www.mapbox.com) account is needed for the map; everything else runs locally.

```bash
git clone https://github.com/N-Soder/hoppy-hour.git
cd hoppy-hour
npm install

cp .env.example .env              # Vite (public, build-time) vars
cp .dev.vars.example .dev.vars    # Functions secrets for wrangler — add your Mapbox token

# Create the local D1 database (stored under .wrangler/, gitignored)
npx wrangler d1 execute hoppy-hour-db --local --file=./db/schema.sql
```

Run the API and the front end in two terminals:

```bash
npm run build && npx wrangler pages dev dist --port 8788   # Functions + local D1/KV/R2
npm run dev                                                 # Vite on http://localhost:8080, proxies /api → :8788
```

The example files use Cloudflare's always-pass Turnstile **test** keys, and `DEV_BYPASS_ACCESS=1` opens `/admin` locally. That bypass only applies to `localhost` requests, so it can never open a deployed site. The admin Snap-a-Deal photo feature also needs `ANTHROPIC_API_KEY` in `.dev.vars`.

**Scripts:**

```bash
npm run dev        # Vite dev server
npm run build      # production build → dist/
npm run lint       # ESLint
npm run typecheck  # TypeScript (app + Pages Functions)
npm run test       # Vitest
```

---

## Deployment

| Component | Platform | Trigger |
|---|---|---|
| Frontend + API (Pages Functions) | Cloudflare Pages | manual via `npm run deploy` (Wrangler direct upload) |
| Database migrations | Cloudflare D1 | manual via `wrangler d1 execute` (see `db/schema.sql`, `db/migrations/`) |

`wrangler.toml` holds the bindings and non-secret vars for the reference deployment. **To deploy your own fork**, create your own resources and replace those values:

1. `npx wrangler d1 create hoppy-hour-db`, then put the new `database_id` in `wrangler.toml` and apply `db/schema.sql` with `--remote`.
2. `npx wrangler kv namespace create RATE_LIMIT`, then put the new `id` in `wrangler.toml`.
3. `npx wrangler r2 bucket create hoppy-hour-submission-images` (keep it private).
4. Create a Cloudflare Access application covering `/admin` and `/api/admin/*`, then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.toml`.
5. Create a Turnstile widget. The site key is compiled into the client bundle, so it must be set wherever the build runs: put `VITE_TURNSTILE_SITE_KEY` in a local `.env.production.local` for `npm run deploy`, or in the Pages **build** environment variables for a Git-connected project. Add the secret as a Pages secret.
6. Add the secrets: `npx wrangler pages secret put MAPBOX_ACCESS_TOKEN` (and `TURNSTILE_SECRET_KEY`, `ANTHROPIC_API_KEY`). Restrict the Mapbox token to your site's URLs.
7. Update the `og:url` / `og:image` URLs in `index.html` to your domain.
8. Deploy with `npm run deploy`, which builds locally and uploads `dist/` and `functions/` to the Pages project named in `wrangler.toml`. Connecting the repository to Pages for push-to-deploy also works; pull-request previews share the production bindings unless you add an `[env.preview]` block.

---

## Contributing & security

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

Copyright © 2026 N. Soderholm.

HoppyHour is released under the [MIT License](LICENSE). Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
