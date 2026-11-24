// Let code that reads or writes a newly added column run against a database
// where the migration adding it has not been applied yet. Migrations are run
// by hand (db/migrations/README.md), so a deploy can land first; these helpers
// make that safe instead of failing every request that touches the column.
//
// Approach: try the query with the column; if SQLite/D1 rejects it because the
// column does not exist, run it again without. After the migration the first
// attempt always succeeds, so there is no extra cost once it has been applied.

/** True when `err` is SQLite/D1 reporting that `column` does not exist. */
export function isMissingColumn(err: unknown, column: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // "no such column: timezone" (SELECT/UPDATE) or
  // "table venues has no column named timezone" (INSERT).
  return new RegExp(`(no such column: (\\w+\\.)?${column}\\b)|(has no column named ${column}\\b)`, "i").test(msg);
}

/**
 * Run `run(present)` with every optional column assumed present, dropping a
 * column from `present` and retrying each time the database says it is
 * missing. Any other error is rethrown. `run` must be safe to repeat after a
 * failed attempt: single statements and D1 batches (which are transactions,
 * and fail at prepare time on an unknown column) both are.
 */
export async function withOptionalColumns<C extends string, T>(
  columns: readonly C[],
  run: (present: ReadonlySet<C>) => Promise<T>,
): Promise<T> {
  const present = new Set<C>(columns);
  for (;;) {
    try {
      return await run(present);
    } catch (err) {
      const missing = [...present].find((c) => isMissingColumn(err, c));
      if (!missing) throw err;
      present.delete(missing);
    }
  }
}
