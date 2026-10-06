-- Migration 0003 — multiple deals per submission.
--
-- The existing deal columns (days_of_week/start_time/end_time/description/tags)
-- keep holding the FIRST deal, so every existing row and every reader of those
-- columns stays valid. Additional deals ride in a JSON array of
-- {days_of_week, start_time, end_time, description, tags} objects; per-element
-- rules are enforced in the Functions (same validateDealFields as deal #1).
--
-- Apply with wrangler (runs the whole file atomically):
--   npx wrangler d1 execute hoppy-hour-db --remote --file=./db/migrations/0003_submission_extra_deals.sql
--
-- If it errors with "duplicate column name", the column already exists — skip.

ALTER TABLE submissions ADD COLUMN extra_deals TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(extra_deals) AND json_type(extra_deals) = 'array');
