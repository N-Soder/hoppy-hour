import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Pages applies functions/api/admin/_middleware.ts (Access JWT + CSRF) to every
// route under that directory and to nothing else. These checks keep it that way.
const FUNCTIONS = path.resolve(__dirname, "../../functions");
const files = (readdirSync(FUNCTIONS, { recursive: true }) as string[])
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.split(path.sep).join("/"));

describe("admin route coverage", () => {
  it("the admin middleware exists and exports onRequest", () => {
    const src = readFileSync(path.join(FUNCTIONS, "api/admin/_middleware.ts"), "utf8");
    expect(src).toMatch(/export const onRequest\b/);
  });

  it("every route touching admin-only data lives under api/admin/", () => {
    // Writes to venues/happy_hours, reads of submissions, and the R2 photo
    // bucket are admin-only. Public routes may only INSERT submissions or read.
    const offenders = files.filter((f) => {
      if (f.startsWith("api/admin/") || f.startsWith("_shared/")) return false;
      const src = readFileSync(path.join(FUNCTIONS, f), "utf8");
      return (
        /(UPDATE|DELETE FROM|INSERT INTO)\s+(venues|happy_hours)/i.test(src) ||
        /FROM\s+submissions/i.test(src) ||
        /SUBMISSION_IMAGES|ANTHROPIC_API_KEY/.test(src)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("no other middleware can run before (and short-circuit around) the admin one", () => {
    const middlewares = files.filter((f) => f.endsWith("_middleware.ts"));
    expect(middlewares).toEqual(["api/admin/_middleware.ts"]);
  });
});
