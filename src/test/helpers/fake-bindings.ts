// In-memory stand-ins for the KV and R2 bindings the Functions use.
import { vi } from "vitest";

export function fakeKv() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, ttl: opts?.expirationTtl });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

export function fakeR2() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    store,
    put: vi.fn(
      async (key: string, value: Uint8Array | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
        store.set(key, { bytes: new Uint8Array(value), contentType: opts?.httpMetadata?.contentType });
      },
    ),
    get: vi.fn(async (key: string) => {
      const hit = store.get(key);
      return hit ? { arrayBuffer: async () => hit.bytes.slice().buffer } : null;
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Smallest byte prefixes that identify each type. */
export const MAGIC = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0x10],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0],
  webp: [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")],
  gif: [...ascii("GIF89a"), 0, 0],
};

export const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
