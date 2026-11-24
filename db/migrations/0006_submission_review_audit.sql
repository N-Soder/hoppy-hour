-- Migration 0006 — who approved or rejected a submission, and when.
--
--  * reviewed_by — the reviewer's Cloudflare Access identity (the email the
--                  admin middleware verified; "dev@localhost" in local dev).
--  * reviewed_at — ISO-8601 UTC time of the decision.
--
-- Both are set on approve and reject, and cleared when a rejected submission
-- is moved back to pending. Rows decided before this migration keep NULLs and
-- the admin lists show nothing extra for them.
--
-- Additive, nullable, no rebuild: safe on a live database. approve/reject/
-- restore write these columns only when they exist, so deploying before or
-- after this migration both work (decisions made before it simply aren't
-- recorded).
--
-- Apply (see db/migrations/README.md for the full order):
--   npx wrangler d1 execute hoppy-hour-db --local  --file=./db/migrations/0006_submission_review_audit.sql
--   npx wrangler d1 execute hoppy-hour-db --remote --file=./db/migrations/0006_submission_review_audit.sql
--
-- D1 dashboard console: run the two statements ONE AT A TIME. If one errors
-- with "duplicate column name", that column already exists — skip it.

ALTER TABLE submissions ADD COLUMN reviewed_by TEXT;

ALTER TABLE submissions ADD COLUMN reviewed_at TEXT;
