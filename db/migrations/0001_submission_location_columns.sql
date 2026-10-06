-- Migration 0001 — capture the submitter's city pick on submissions.
--
-- Additive columns only: city + ISO country + coordinates. Safe to run — no
-- table rebuild, no foreign keys involved. This is all the schema change the
-- public submit form needs.
--
-- Apply with wrangler (runs the whole file atomically):
--   npx wrangler d1 execute hoppy-hour-db --remote --file=./db/migrations/0001_submission_location_columns.sql
--
-- Or paste each statement individually into the D1 dashboard console (its
-- multi-statement runner is unreliable — one at a time). If a statement errors
-- with "duplicate column name", that column already exists — skip it.

ALTER TABLE submissions ADD COLUMN city    TEXT;
ALTER TABLE submissions ADD COLUMN country TEXT;
ALTER TABLE submissions ADD COLUMN lat     REAL;
ALTER TABLE submissions ADD COLUMN lng     REAL;
