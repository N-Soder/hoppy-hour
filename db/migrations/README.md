# Database migrations

D1 does not track which of these files have been applied: there is no
migrations table, and wrangler's `d1 migrations` tracking is deliberately not
used. Each file is applied by hand with `wrangler d1 execute`, once per
database, in number order.

`db/schema.sql` is always the full current schema. A **new** database (local
or a fork's production) gets `schema.sql` only and needs none of these files.
An **existing** database needs every file numbered after the schema it was
created from.

## Files, in order

| File | What it does | Safe on a live database |
|---|---|---|
| `0001_submission_location_columns.sql` | `submissions`: city, country, lat, lng | Yes, additive |
| `0002_widen_venues_country.sql` | `venues.country`: any ISO code (table rebuild) | Quiet time; see the file's notes |
| `0003_submission_extra_deals.sql` | `submissions.extra_deals` (more than one deal per submission) | Yes, additive |
| `0004_submission_photo_and_venue_link.sql` | `submissions`: source, image_key, venue_id | Yes, additive |
| `0005_venue_timezone.sql` | `venues.timezone` (IANA zone the deal times are in) | Yes, additive |
| `0006_submission_review_audit.sql` | `submissions`: reviewed_by, reviewed_at | Yes, additive |

To see which have been applied to a database, check for their columns, for
example:

```bash
npx wrangler d1 execute hoppy-hour-db --remote --command "PRAGMA table_info(venues)"
npx wrangler d1 execute hoppy-hour-db --remote --command "PRAGMA table_info(submissions)"
```

An additive migration that has already run fails with `duplicate column name`;
that is harmless and means there is nothing to do.

## Applying 0005 and 0006

Local (the database `wrangler pages dev` uses):

```bash
npx wrangler d1 execute hoppy-hour-db --local --file=./db/migrations/0005_venue_timezone.sql
npx wrangler d1 execute hoppy-hour-db --local --file=./db/migrations/0006_submission_review_audit.sql
node scripts/backfill-timezones.mjs --local
```

Production:

```bash
npx wrangler d1 execute hoppy-hour-db --remote --file=./db/migrations/0005_venue_timezone.sql
npx wrangler d1 execute hoppy-hour-db --remote --file=./db/migrations/0006_submission_review_audit.sql
node scripts/backfill-timezones.mjs --remote --dry-run   # lists what it would fill
node scripts/backfill-timezones.mjs --remote
```

The backfill fills `venues.timezone` from each venue's coordinates where it is
NULL. It only touches NULL rows, so it is safe to run again (for example after
importing venues by hand).

### Deploy order

The code reads and writes these columns only when they exist, so either order
works:

- **Deploy first, migrate later:** venues report `timezone: null` and the app
  works out live deals in the viewer's own zone, as it did before; approvals
  and rejections succeed but who/when is not recorded.
- **Migrate first, deploy later:** the old code ignores the new columns.

Run the backfill after 0005 is applied; until it runs, existing venues use the
viewer's zone. Venues created or moved after the deploy get their zone
automatically.
