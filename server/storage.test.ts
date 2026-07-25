/**
 * Storage (Cloudflare R2) tests.
 *
 * Exercises the real AWS SDK S3 client against a local S3-compatible HTTP
 * stub, so the upload path (signing → PUT → response handling) is proven
 * without needing production R2 credentials. Presigned URL generation is
 * offline by nature, so it's asserted exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** Every var the module reads — the whole set must be cleared per test, or a
 *  leaked bucket/credential from the host env would mask a regression. */
const R2_ENV_KEYS = [
  "R2_ENDPOINT",
  "CLOUDFLARE_R2_ENDPOINT",
  "S3_ENDPOINT",
  "R2_ACCOUNT_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "S3_ACCESS_KEY_ID",
  "AWS_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "S3_SECRET_ACCESS_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_BUCKET_NAME",
  "CLOUDFLARE_R2_BUCKET",
  "S3_BUCKET",
];

const PARTNER_BUCKET = "partner-portal-documents";

function clearR2Env() {
  for (const key of R2_ENV_KEYS) delete process.env[key];
}

/** Fresh module instance so the cached S3 client picks up current env. */
async function loadStorage() {
  vi.resetModules();
  return import("./storage");
}

describe("R2 configuration", () => {
  beforeEach(clearR2Env);
  afterEach(clearR2Env);

  it("reports not configured when credentials are missing", async () => {
    const storage = await loadStorage();
    expect(storage.isStorageConfigured()).toBe(false);
  });

  it("fails with a message naming the missing Railway variables (not Forge)", async () => {
    const storage = await loadStorage();
    await expect(storage.storagePut("x/y.pdf", Buffer.from("hi"))).rejects.toThrow(
      /Cloudflare R2 no está configurado.*R2_ENDPOINT.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY.*R2_BUCKET/s
    );
    // The old Forge error must be gone — that was the bug blocking uploads.
    await expect(storage.storagePut("x/y.pdf", Buffer.from("hi"))).rejects.not.toThrow(/FORGE/i);
  });

  it("derives the R2 endpoint from the account id and accepts credential aliases", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "key";
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET_NAME = PARTNER_BUCKET; // alias of R2_BUCKET — Railway sets both
    const storage = await loadStorage();
    expect(storage.isStorageConfigured()).toBe(true);
    const { url } = await storage.storageGet("partner-documents/1/report/a.pdf");
    // The SDK addresses R2 virtual-hosted style: <bucket>.<account>.r2.cloudflarestorage.com
    expect(url).toContain("acct123.r2.cloudflarestorage.com");
    expect(url).toContain(PARTNER_BUCKET);
  });
});

/**
 * The bucket has NO default on purpose. A fallback name meant that deleting
 * R2_BUCKET (or cloning the Railway service without it) would silently write
 * partner documents into LeadPrime's production bucket — no error, no trace.
 */
describe("bucket resolution has no silent fallback", () => {
  beforeEach(clearR2Env);
  afterEach(clearR2Env);

  it("throws instead of guessing a bucket when none is configured", async () => {
    const storage = await loadStorage();
    expect(() => storage.getBucketName()).toThrow(/bucket no configurado.*R2_BUCKET/s);
  });

  it("never falls back to LeadPrime's production bucket", async () => {
    const storage = await loadStorage();
    // Neither the return value nor the failure may point at the LeadPrime bucket.
    let outcome = "";
    try {
      outcome = storage.getBucketName();
    } catch (error) {
      outcome = (error as Error).message;
    }
    expect(outcome).not.toContain("leadprime-documents");
  });

  it("is 'not configured' when credentials are present but the bucket is missing", async () => {
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    const storage = await loadStorage();
    expect(storage.isStorageConfigured()).toBe(false);
    // ...and an upload fails loudly rather than landing in an unknown bucket.
    await expect(
      storage.storagePut("partner-documents/1/x.pdf", Buffer.from("hi"))
    ).rejects.toThrow(/R2_BUCKET/);
  });

  it("reads each accepted bucket alias", async () => {
    for (const alias of ["R2_BUCKET", "R2_BUCKET_NAME", "CLOUDFLARE_R2_BUCKET", "S3_BUCKET"]) {
      clearR2Env();
      process.env[alias] = PARTNER_BUCKET;
      const storage = await loadStorage();
      expect(storage.getBucketName(), `alias ${alias}`).toBe(PARTNER_BUCKET);
    }
  });
});

describe("presigned download URLs", () => {
  beforeEach(() => {
    clearR2Env();
    process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    process.env.R2_BUCKET = PARTNER_BUCKET;
  });
  afterEach(clearR2Env);

  it("signs a time-limited URL for the right bucket and key", async () => {
    const storage = await loadStorage();
    const key = "partner-documents/7/report/1234-reporte.pdf";
    const { url, key: outKey } = await storage.storageGet(key);
    expect(outKey).toBe(key);
    // Bucket + full key must both be addressed (style may be virtual-hosted).
    expect(url).toContain(PARTNER_BUCKET);
    expect(url).toContain("partner-documents/7/report/1234-reporte.pdf");
    // Signed and expiring — this is what keeps documents private per tenant.
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=900");
  });

  it("normalizes leading slashes in keys", async () => {
    const storage = await loadStorage();
    const { key } = await storage.storageGet("/partner-documents/1/w9/x.pdf");
    expect(key).toBe("partner-documents/1/w9/x.pdf");
  });
});

describe("upload against an S3-compatible endpoint", () => {
  let server: Server;
  let received: { method: string; url: string; body: Buffer; contentType?: string } | null = null;

  beforeEach(async () => {
    clearR2Env();
    received = null;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        received = {
          method: req.method ?? "",
          url: req.url ?? "",
          body: Buffer.concat(chunks),
          contentType: req.headers["content-type"],
        };
        res.writeHead(200, { ETag: '"abc123"' });
        res.end();
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    process.env.R2_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    process.env.R2_BUCKET = PARTNER_BUCKET;
  });

  afterEach(async () => {
    clearR2Env();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it("PUTs the file bytes to bucket/key and returns the key (not an expiring URL)", async () => {
    const storage = await loadStorage();
    const body = Buffer.from("%PDF-1.4 fake report");
    const result = await storage.storagePut(
      "partner-documents/3/report/999-reporte_q3.pdf",
      body,
      "application/pdf"
    );

    expect(received).not.toBeNull();
    expect(received!.method).toBe("PUT");
    // The SDK appends ?x-id=PutObject; assert on the path.
    expect(received!.url.split("?")[0]).toBe(
      `/${PARTNER_BUCKET}/partner-documents/3/report/999-reporte_q3.pdf`
    );
    expect(received!.body.toString()).toBe("%PDF-1.4 fake report");
    expect(received!.contentType).toBe("application/pdf");

    // Persisting the KEY (not a signed URL) is deliberate: signed URLs expire.
    expect(result.key).toBe("partner-documents/3/report/999-reporte_q3.pdf");
    expect(result.url).toBe(result.key);
  });

  it("accepts string payloads too", async () => {
    const storage = await loadStorage();
    await storage.storagePut("generated/x.txt", "hello", "text/plain");
    expect(received!.body.toString()).toBe("hello");
  });
});
