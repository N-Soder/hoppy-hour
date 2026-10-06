// GET /api/admin/submissions/:id/image — serve a photo submission's stored
// image from R2. Sits behind the /api/admin middleware (Cloudflare Access),
// so the bucket never needs to be public.
import type { Env } from "../../../../_shared/db";
import { error } from "../../../../_shared/http";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const row = await env.DB.prepare(`SELECT image_key FROM submissions WHERE id = ?1`).bind(id)
    .first<{ image_key: string | null }>();
  if (!row) return error("submission not found", 404);
  if (!row.image_key) return error("submission has no image", 404);

  const object = await env.SUBMISSION_IMAGES.get(row.image_key);
  if (!object) return error("image not found in storage", 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // Immutable per submission; private since it's behind Access anyway.
      "Cache-Control": "private, max-age=86400",
      ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
    },
  });
};
