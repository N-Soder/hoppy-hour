// Short-lived handles for photos read by the public POST /api/menu-photo.
//
// The photo is uploaded once, with the read request, and stored in R2 under
// `pending/`. The client gets back only an opaque random `upload_id` — never
// the R2 key or a URL. The KV record behind it (TTL 1 hour) maps the id to the
// key and to the IP that uploaded it. The final POST /api/submissions sends
// the id back; claiming it checks the IP, moves the object from `pending/` to
// `submissions/` inside R2 (a server-side copy, the client never re-sends it)
// and forgets the id, so it can be used once.
//
// Unclaimed photos stay under `pending/` and are removed by an R2 lifecycle
// rule on that prefix (see the PR / wrangler.toml for the one-time setup).
import { imageExtension, type ImageMediaType } from "./menu-extract";

export const UPLOAD_TTL_SECONDS = 60 * 60;
export const PENDING_PREFIX = "pending/";
const UPLOAD_ID_RE = /^[0-9a-f]{32}$/;

interface UploadRecord {
  key: string;
  ip: string;
  media_type: ImageMediaType;
}

const kvKey = (uploadId: string) => `photo_upload:${uploadId}`;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Store a freshly read photo under pending/ and mint its upload_id. */
export async function createPhotoUpload(
  env: { RATE_LIMIT: KVNamespace; SUBMISSION_IMAGES: R2Bucket },
  bytes: Uint8Array,
  mediaType: ImageMediaType,
  ip: string,
): Promise<{ uploadId: string; expiresIn: number }> {
  const uploadId = randomId();
  // The R2 key uses its own random name, so the id alone reveals nothing.
  const key = `${PENDING_PREFIX}${crypto.randomUUID()}.${imageExtension(mediaType)}`;
  await env.SUBMISSION_IMAGES.put(key, bytes, { httpMetadata: { contentType: mediaType } });
  const record: UploadRecord = { key, ip, media_type: mediaType };
  await env.RATE_LIMIT.put(kvKey(uploadId), JSON.stringify(record), {
    expirationTtl: UPLOAD_TTL_SECONDS,
  });
  return { uploadId, expiresIn: UPLOAD_TTL_SECONDS };
}

export type ClaimResult =
  | { ok: true; imageKey: string }
  | { ok: false; reason: "invalid" | "expired" | "ip_mismatch" };

/**
 * Claim an upload for the submission being inserted. On success the photo now
 * lives at `submissions/<submissionId>.<ext>` and the id is spent.
 *
 * Not atomic (KV): two simultaneous submits with one id could both pass the
 * record check; the second then finds the pending object already moved and
 * gets "expired".
 */
export async function claimPhotoUpload(
  env: { RATE_LIMIT: KVNamespace; SUBMISSION_IMAGES: R2Bucket },
  uploadId: unknown,
  ip: string,
  submissionId: string,
): Promise<ClaimResult> {
  if (typeof uploadId !== "string" || !UPLOAD_ID_RE.test(uploadId)) {
    return { ok: false, reason: "invalid" };
  }
  const raw = await env.RATE_LIMIT.get(kvKey(uploadId));
  if (!raw) return { ok: false, reason: "expired" };
  let record: UploadRecord;
  try {
    record = JSON.parse(raw) as UploadRecord;
  } catch {
    return { ok: false, reason: "expired" };
  }
  if (record.ip !== ip) return { ok: false, reason: "ip_mismatch" };

  const object = await env.SUBMISSION_IMAGES.get(record.key);
  if (!object) return { ok: false, reason: "expired" };
  const imageKey = `submissions/${submissionId}.${imageExtension(record.media_type)}`;
  await env.SUBMISSION_IMAGES.put(imageKey, await object.arrayBuffer(), {
    httpMetadata: { contentType: record.media_type },
  });
  // Best effort: a leftover pending object is removed by the lifecycle rule.
  await Promise.allSettled([
    env.SUBMISSION_IMAGES.delete(record.key),
    env.RATE_LIMIT.delete(kvKey(uploadId)),
  ]);
  return { ok: true, imageKey };
}
