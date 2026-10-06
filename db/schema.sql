-- HoppyHour — Cloudflare D1 (SQLite) schema.
-- Source of truth for the database structure.
-- Apply:
--   npx wrangler d1 execute hoppy-hour-db --local  --file=./db/schema.sql
--   npx wrangler d1 execute hoppy-hour-db --remote --file=./db/schema.sql
--
-- Design notes:
--  * UUIDs stay as TEXT; new rows get crypto.randomUUID() in the Function, so
--    there is deliberately no DEFAULT on id — every insert path is our code.
--  * Times are TEXT 'HH:MM:SS'. The client compares times as strings, so
--    a GLOB CHECK pins the fixed width. (Format-pinning only; the Functions also
--    range-check hours/minutes, since [0-2][0-9] would admit '25:00:00'.)
--  * Arrays are TEXT holding a JSON array. SQLite CHECK can't iterate
--    JSON, so per-element rules (days 0-6, allowed tag set) live in the Functions.
--  * Locations are plain REAL lat / REAL lng; radius search is a
--    bounding-box prefilter (indexed) + haversine in JS.
--  * updated_at is set app-side on every UPDATE (new Date().toISOString()).
--  * Timestamps are TEXT ISO-8601 UTC, which sorts lexically.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS venues (
  id         TEXT PRIMARY KEY,                 -- UUID; generated in the Function
  name       TEXT NOT NULL CHECK (length(name) <= 200),
  address    TEXT NOT NULL CHECK (length(address) <= 500),
  -- ISO 3166-1 alpha-2. Was restricted to a 5-country launch set; now any valid
  -- code so venues can be submitted worldwide (see db/migrations/0001).
  country    TEXT CHECK (country IS NULL OR country GLOB '[A-Z][A-Z]'),
  lat        REAL,
  lng        REAL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_venues_status ON venues (status);

-- Bounding-box prefilter index. Partial: the public API only ever returns
-- active venues. SQLite
-- range-scans lat and filters lng within the same composite index.
CREATE INDEX IF NOT EXISTS idx_venues_active_lat_lng
  ON venues (lat, lng) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS happy_hours (
  id           TEXT PRIMARY KEY,
  venue_id     TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  days_of_week TEXT NOT NULL DEFAULT '[]'      -- JSON array of ints 0-6, 0=Sunday
               CHECK (json_valid(days_of_week) AND json_type(days_of_week) = 'array'),
  start_time   TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]:[0-5][0-9]'),
  end_time     TEXT NOT NULL CHECK (end_time   GLOB '[0-2][0-9]:[0-5][0-9]:[0-5][0-9]'),
  description  TEXT NOT NULL CHECK (length(description) <= 1000),
  tags         TEXT NOT NULL DEFAULT '[]'      -- JSON array; allowed values enforced app-side
               CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_happy_hours_venue ON happy_hours (venue_id);

CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT PRIMARY KEY,
  venue_name    TEXT NOT NULL CHECK (length(venue_name) <= 200),
  -- Street address is optional now (empty string when omitted); city + country
  -- + coordinates come from the submitter's city pick.
  venue_address TEXT NOT NULL CHECK (length(venue_address) <= 500),
  city          TEXT CHECK (city IS NULL OR length(city) <= 200),
  country       TEXT CHECK (country IS NULL OR country GLOB '[A-Z][A-Z]'),
  lat           REAL,
  lng           REAL,
  days_of_week  TEXT NOT NULL
                CHECK (json_valid(days_of_week) AND json_type(days_of_week) = 'array'),
  start_time    TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]:[0-5][0-9]'),
  end_time      TEXT NOT NULL CHECK (end_time   GLOB '[0-2][0-9]:[0-5][0-9]:[0-5][0-9]'),
  description   TEXT NOT NULL CHECK (length(description) <= 1000),
  tags          TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  -- Deals beyond the first (which lives in the columns above): JSON array of
  -- {days_of_week, start_time, end_time, description, tags} objects. Element
  -- shape is enforced in the Functions (see db/migrations/0003).
  extra_deals   TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(extra_deals) AND json_type(extra_deals) = 'array'),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  -- 'form' = public submit form; 'photo' = admin Snap-a-Deal upload where a
  -- vision model pre-fills the fields from a menu photo (see db/migrations/0004).
  source        TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form','photo')),
  -- R2 object key of the compressed photo (photo submissions only).
  image_key     TEXT,
  -- Set at approval when the reviewer attaches the submission to an EXISTING
  -- venue instead of creating a new one (see db/migrations/0004).
  venue_id      TEXT REFERENCES venues(id) ON DELETE SET NULL,
  honeypot      TEXT CHECK (honeypot IS NULL OR length(honeypot) <= 100),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status);
