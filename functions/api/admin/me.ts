// GET /api/admin/me — admin-state probe. Unreachable unauthenticated (Access +
// the _middleware guarantee it); the SPA uses a 200 here as "you are admin".
import type { Env } from "../../_shared/db";
import { json } from "../../_shared/http";

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return json({ email: (ctx.data.adminEmail as string) ?? "admin" });
};
