-- Migration 0004 — photo submissions + linking submissions to existing venues.
--
-- Adds three columns to submissions:
--  * source    — 'form' (public submit form) or 'photo' (admin Snap-a-Deal upload,
--                where a vision model pre-fills the fields from a menu photo).
--  * image_key — R2 object key of the compressed photo (photo submissions only),
--                served back to admins via GET /api/admin/submissions/:id/image.
--  * venue_id  — set at approval time when the reviewer attaches the submission
--                to an EXISTING venue instead of creating a new one. ON DELETE
--                SET NULL so deleting a venue doesn't orphan the audit record.
--
-- HOW TO APPLY — two options:
--
-- A) wrangler (atomic, preferred if you have CLI access):
--    npx wrangler d1 execute hoppy-hour-db --local  --file=./db/migrations/0004_submission_photo_and_venue_link.sql
--    npx wrangler d1 execute hoppy-hour-db --remote --file=./db/migrations/0004_submission_photo_and_venue_link.sql
--
-- B) D1 dashboard console (UI only — no terminal): the console can't run a
--    multi-statement paste, so run the three ALTER TABLE statements below ONE
--    AT A TIME, in order. Unlike migration 0002 there is no table rebuild and
--    no cascade — each statement is a plain additive ADD COLUMN, safe on a
--    live database. Optional safety net: run `/bookmark` first and keep the id.
--    Verify afterwards with:
--      SELECT source, image_key, venue_id FROM submissions LIMIT 1;
--
-- If a statement errors with "duplicate column name", that column already
-- exists (e.g. a partial earlier run) — skip it and continue with the next.

ALTER TABLE submissions ADD COLUMN source TEXT NOT NULL DEFAULT 'form'
  CHECK (source IN ('form','photo'));

ALTER TABLE submissions ADD COLUMN image_key TEXT;

ALTER TABLE submissions ADD COLUMN venue_id TEXT REFERENCES venues(id) ON DELETE SET NULL;
