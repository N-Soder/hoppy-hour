// Fill venues.timezone for venues that have coordinates but no time zone yet
// (every venue that existed before migration 0005). Uses the same lookup as the
// Functions (@photostructure/tz-lookup; see functions/_shared/timezone.ts).
//
//   node scripts/backfill-timezones.mjs --local              # local D1
//   node scripts/backfill-timezones.mjs --remote             # production D1
//   node scripts/backfill-timezones.mjs --remote --dry-run   # show, don't write
//
// Safe to run any number of times: it only touches rows whose timezone is
// NULL, and each UPDATE re-checks that in its WHERE clause. Venues without
// coordinates are left NULL (the app falls back to the viewer's zone).
// Requires migration 0005 to have been applied to the same database first.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tzlookup from "@photostructure/tz-lookup";

const DB = "hoppy-hour-db";
const args = process.argv.slice(2);
const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
const dryRun = args.includes("--dry-run");
if (!target) {
  console.error("Usage: node scripts/backfill-timezones.mjs --local|--remote [--dry-run]");
  process.exit(2);
}

function wrangler(extra, { interactive = false } = {}) {
  return execFileSync("npx", ["wrangler", "d1", "execute", DB, target, ...extra], {
    encoding: "utf8",
    // Interactive: wrangler may ask to confirm a --remote file import.
    stdio: interactive ? "inherit" : ["ignore", "pipe", "inherit"],
  });
}

function query(sql) {
  const out = wrangler(["--json", "--command", sql]);
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
}

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

const rows = query(
  "SELECT id, name, lat, lng FROM venues WHERE timezone IS NULL AND lat IS NOT NULL AND lng IS NOT NULL",
);
const updates = [];
for (const r of rows) {
  let zone = null;
  try {
    zone = tzlookup(r.lat, r.lng);
  } catch {
    // Invalid coordinates: leave NULL.
  }
  if (!zone) {
    console.warn(`  skip  ${r.id}  ${r.name}: no zone for ${r.lat}, ${r.lng}`);
    continue;
  }
  console.log(`  ${zone.padEnd(24)} ${r.id}  ${r.name}`);
  updates.push(`UPDATE venues SET timezone = ${sqlString(zone)} WHERE id = ${sqlString(r.id)} AND timezone IS NULL;`);
}

const [{ n: noCoords } = { n: 0 }] = query(
  "SELECT COUNT(*) AS n FROM venues WHERE timezone IS NULL AND (lat IS NULL OR lng IS NULL)",
);
console.log(`${updates.length} venue(s) to fill; ${noCoords} without coordinates left as NULL.`);

if (updates.length === 0 || dryRun) {
  if (dryRun) console.log("Dry run: nothing written.");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "hoppy-tz-"));
const file = join(dir, "backfill-timezones.sql");
try {
  writeFileSync(file, `${updates.join("\n")}\n`);
  wrangler(["--file", file], { interactive: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const [{ n: remaining } = { n: 0 }] = query(
  "SELECT COUNT(*) AS n FROM venues WHERE timezone IS NULL AND lat IS NOT NULL AND lng IS NOT NULL",
);
console.log(`Done. Venues with coordinates still missing a zone: ${remaining}.`);
