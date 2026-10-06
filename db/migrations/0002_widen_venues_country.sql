-- Migration 0002 — widen venues.country from the 5-country launch set to any
-- ISO 3166-1 alpha-2 code.
--
-- HOW TO APPLY — two options:
--
-- A) wrangler (atomic, preferred if you have CLI access):
--    npx wrangler d1 execute hoppy-hour-db --remote --file=./db/migrations/0002_widen_venues_country.sql
--
-- B) D1 dashboard console (UI only — no terminal): the console can't run a
--    multi-statement paste, so run each statement below ONE AT A TIME, in order.
--    FIRST run `/bookmark` and save the id it returns (your safety net). The
--    DROP TABLE step briefly empties happy_hours (cascade) until the restore two
--    steps later, so do this at a quiet time; if anything goes wrong at any
--    point, run `/restore <bookmark-id>`. Verify `SELECT COUNT(*) FROM
--    happy_hours;` returns the original count at the end.
--
-- Why the backup/restore: SQLite changes a CHECK constraint only by rebuilding
-- the table. Dropping venues fires happy_hours' ON DELETE CASCADE. On D1 this
-- cannot be prevented — D1 runs everything in a transaction, so
-- `PRAGMA foreign_keys=OFF` is a no-op and cascades still execute. So we copy
-- happy_hours out first and restore it after the swap, within the same tx.

-- 1. Back up happy_hours (plain table: no FK, unaffected by the cascade).
CREATE TABLE _happy_hours_backup AS SELECT * FROM happy_hours;

-- 2. Rebuild venues with the widened country CHECK.
CREATE TABLE venues_new (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) <= 200),
  address    TEXT NOT NULL CHECK (length(address) <= 500),
  country    TEXT CHECK (country IS NULL OR country GLOB '[A-Z][A-Z]'),
  lat        REAL,
  lng        REAL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO venues_new (id, name, address, country, lat, lng, status, created_at, updated_at)
  SELECT id, name, address, country, lat, lng, status, created_at, updated_at FROM venues;

-- 3. Swap. DROP venues cascade-empties happy_hours (rows preserved in backup).
DROP TABLE venues;
ALTER TABLE venues_new RENAME TO venues;
CREATE INDEX IF NOT EXISTS idx_venues_status ON venues (status);
CREATE INDEX IF NOT EXISTS idx_venues_active_lat_lng
  ON venues (lat, lng) WHERE status = 'active';

-- 4. Restore happy_hours (venue ids unchanged, so the FK resolves immediately).
INSERT INTO happy_hours SELECT * FROM _happy_hours_backup;
DROP TABLE _happy_hours_backup;
