// A minimal D1 stand-in backed by node:sqlite, loaded with the real
// db/schema.sql, so Function handlers can be tested against real SQL (CHECK
// constraints, ?N bindings, batches) without wrangler. Test-only.
import { readFileSync } from "node:fs";
import path from "node:path";
import type * as NodeSqlite from "node:sqlite";

// Loaded at runtime rather than imported: under vite 8 the jsdom (client)
// environment refuses to resolve the prefix-only "node:sqlite" builtin.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof NodeSqlite;
type DatabaseSync = NodeSqlite.DatabaseSync;

type Value = string | number | null;

interface RunMeta {
  meta: { changes: number };
}

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Value[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : (p as Value))));
  }

  /** D1 numbers its placeholders ?1, ?2…; node:sqlite accepts the same form. */
  private stmt() {
    return this.db.prepare(this.sql);
  }

  async run(): Promise<RunMeta> {
    return this.runSync();
  }

  runSync(): RunMeta {
    const r = this.stmt().run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.stmt().all(...this.params) as T[] };
  }

  async first<T>(): Promise<T | null> {
    return (this.stmt().get(...this.params) as T | undefined) ?? null;
  }
}

export interface SqliteD1 {
  DB: {
    prepare(sql: string): Statement;
    batch(stmts: Statement[]): Promise<RunMeta[]>;
  };
  /** Run raw SQL against the database (fixtures and assertions). */
  exec(sql: string): void;
  query<T = Record<string, unknown>>(sql: string, ...params: Value[]): T[];
}

export function createSqliteD1(): SqliteD1 {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.resolve(__dirname, "../../../db/schema.sql"), "utf8"));
  return {
    DB: {
      prepare: (sql: string) => new Statement(db, sql),
      // D1 batches are transactions: all statements commit or none do.
      async batch(stmts: Statement[]) {
        db.exec("BEGIN");
        try {
          const out = stmts.map((s) => s.runSync());
          db.exec("COMMIT");
          return out;
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      },
    },
    exec: (sql: string) => db.exec(sql),
    query: <T,>(sql: string, ...params: Value[]) => db.prepare(sql).all(...params) as T[],
  };
}
