import { describe, it, expect } from "vitest";
import { claimPhotoUpload, createPhotoUpload } from "../../functions/_shared/photo-upload";
import { fakeKv, fakeR2 } from "./helpers/fake-bindings";

function envOf() {
  const kv = fakeKv();
  const r2 = fakeR2();
  return { kv, r2, env: { RATE_LIMIT: kv as unknown as KVNamespace, SUBMISSION_IMAGES: r2 as unknown as R2Bucket } };
}
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

describe("photo upload handle", () => {
  it("stores once under pending/ and returns only an opaque id with a 1h TTL", async () => {
    const { kv, r2, env } = envOf();
    const { uploadId, expiresIn } = await createPhotoUpload(env, bytes, "image/jpeg", "1.1.1.1");
    expect(uploadId).toMatch(/^[0-9a-f]{32}$/);
    expect(expiresIn).toBe(3600);
    expect(r2.put).toHaveBeenCalledTimes(1);
    const [key] = [...r2.store.keys()];
    expect(key).toMatch(/^pending\/.+\.jpg$/);
    expect(key).not.toContain(uploadId);
    expect(kv.store.get(`photo_upload:${uploadId}`)?.ttl).toBe(3600);
  });

  it("claim moves the photo to submissions/<id> and spends the id", async () => {
    const { r2, env } = envOf();
    const { uploadId } = await createPhotoUpload(env, bytes, "image/webp", "1.1.1.1");
    const claim = await claimPhotoUpload(env, uploadId, "1.1.1.1", "sub-1");
    expect(claim).toEqual({ ok: true, imageKey: "submissions/sub-1.webp" });
    expect([...r2.store.keys()]).toEqual(["submissions/sub-1.webp"]);
    expect(r2.store.get("submissions/sub-1.webp")?.bytes).toEqual(bytes);
    // Second use fails.
    expect(await claimPhotoUpload(env, uploadId, "1.1.1.1", "sub-2")).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a claim from another IP and leaves the upload intact", async () => {
    const { r2, env } = envOf();
    const { uploadId } = await createPhotoUpload(env, bytes, "image/jpeg", "1.1.1.1");
    expect(await claimPhotoUpload(env, uploadId, "9.9.9.9", "sub-1")).toEqual({ ok: false, reason: "ip_mismatch" });
    expect([...r2.store.keys()][0]).toMatch(/^pending\//);
  });

  it("treats an expired (KV-evicted) id as expired", async () => {
    const { kv, env } = envOf();
    const { uploadId } = await createPhotoUpload(env, bytes, "image/jpeg", "1.1.1.1");
    kv.store.delete(`photo_upload:${uploadId}`); // what the TTL does after an hour
    expect(await claimPhotoUpload(env, uploadId, "1.1.1.1", "s")).toEqual({ ok: false, reason: "expired" });
  });

  it("treats a missing pending object as expired", async () => {
    const { r2, env } = envOf();
    const { uploadId } = await createPhotoUpload(env, bytes, "image/jpeg", "1.1.1.1");
    r2.store.clear(); // lifecycle rule already removed it
    expect(await claimPhotoUpload(env, uploadId, "1.1.1.1", "s")).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed ids without touching storage", async () => {
    const { kv, env } = envOf();
    for (const id of ["", "abc", "../../etc", 42, "A".repeat(32)]) {
      expect(await claimPhotoUpload(env, id, "1.1.1.1", "s")).toEqual({ ok: false, reason: "invalid" });
    }
    expect(kv.get).not.toHaveBeenCalled();
  });
});
