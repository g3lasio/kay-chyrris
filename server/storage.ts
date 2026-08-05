/**
 * File storage — Cloudflare R2 (S3-compatible).
 *
 * R2 is the Chyrris ecosystem's storage convention. This replaces the old
 * "Forge" storage proxy (BUILT_IN_FORGE_API_*), which was never configured in
 * Railway and made every partner-document upload fail with
 * "Storage proxy credentials missing".
 *
 * Objects are stored PRIVATE. Downloads go through short-lived presigned URLs
 * (storageGet), so a document is only reachable by someone the app authorized
 * — this is what keeps partner documents multi-tenant safe even if a URL
 * leaks (it expires).
 *
 * Required env vars in Railway (see .env.example). Several aliases are
 * accepted so whatever naming the Railway project already uses works:
 *   Account/endpoint : R2_ENDPOINT  (or R2_ACCOUNT_ID / CLOUDFLARE_ACCOUNT_ID)
 *   Access key       : R2_ACCESS_KEY_ID     | CLOUDFLARE_R2_ACCESS_KEY_ID | S3_ACCESS_KEY_ID
 *   Secret key       : R2_SECRET_ACCESS_KEY | CLOUDFLARE_R2_SECRET_ACCESS_KEY | S3_SECRET_ACCESS_KEY
 *   Bucket           : R2_BUCKET | R2_BUCKET_NAME | CLOUDFLARE_R2_BUCKET  (REQUIRED — no default)
 *
 * The bucket has NO fallback on purpose. Partner documents live in their own
 * isolated bucket (partner-portal-documents); guessing a default meant that
 * losing R2_BUCKET — a deleted variable, a cloned service — would silently
 * write partner documents into LeadPrime's production bucket with no error to
 * betray it. Failing loudly is the safe direction.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET_ENV_VARS = ["R2_BUCKET", "R2_BUCKET_NAME", "CLOUDFLARE_R2_BUCKET", "S3_BUCKET"] as const;
const DOWNLOAD_URL_TTL_SECONDS = 60 * 15; // 15 min — long enough to open/download

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

type R2Config = { client: S3Client; bucket: string };

let cached: R2Config | null = null;

function resolveEndpoint(): string | undefined {
  const explicit = firstEnv("R2_ENDPOINT", "CLOUDFLARE_R2_ENDPOINT", "S3_ENDPOINT");
  if (explicit) return explicit.replace(/\/+$/, "");
  const accountId = firstEnv("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_R2_ACCOUNT_ID");
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
  return undefined;
}

const MISSING_BUCKET_MESSAGE =
  "Cloudflare R2: bucket no configurado — set R2_BUCKET=partner-portal-documents en Railway " +
  `(alias aceptados: ${BUCKET_ENV_VARS.slice(1).join(", ")}). ` +
  "No se usa un bucket por defecto a propósito: escribir documentos de socios en el bucket " +
  "equivocado en silencio es peor que fallar.";

function resolveBucket(): string | undefined {
  return firstEnv(...BUCKET_ENV_VARS);
}

/**
 * The configured bucket. Throws when none is set — never falls back to a
 * guessed name, so a missing variable can't route partner documents into
 * somebody else's bucket without anyone noticing.
 */
export function getBucketName(): string {
  const bucket = resolveBucket();
  if (!bucket) throw new Error(MISSING_BUCKET_MESSAGE);
  return bucket;
}

/** True when R2 is fully configured — lets callers degrade gracefully. */
export function isStorageConfigured(): boolean {
  return Boolean(
    resolveEndpoint() &&
      resolveBucket() &&
      firstEnv("R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID") &&
      firstEnv(
        "R2_SECRET_ACCESS_KEY",
        "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
        "S3_SECRET_ACCESS_KEY",
        "AWS_SECRET_ACCESS_KEY"
      )
  );
}

function getClient(): R2Config {
  if (cached) return cached;

  const endpoint = resolveEndpoint();
  const accessKeyId = firstEnv(
    "R2_ACCESS_KEY_ID",
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "S3_ACCESS_KEY_ID",
    "AWS_ACCESS_KEY_ID"
  );
  const secretAccessKey = firstEnv(
    "R2_SECRET_ACCESS_KEY",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    "S3_SECRET_ACCESS_KEY",
    "AWS_SECRET_ACCESS_KEY"
  );

  const bucket = resolveBucket();

  const missing: string[] = [];
  if (!endpoint) missing.push("R2_ENDPOINT (o R2_ACCOUNT_ID)");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("R2_BUCKET");
  if (missing.length > 0) {
    throw new Error(
      `Cloudflare R2 no está configurado. Faltan variables de entorno en Railway: ${missing.join(", ")}.` +
        (bucket ? ` Bucket usado: "${bucket}".` : ` ${MISSING_BUCKET_MESSAGE}`)
    );
  }

  cached = {
    // R2 ignores the region but the SDK requires one; "auto" is the documented value.
    client: new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    }),
    bucket: bucket!,
  };
  console.log(`[Storage] Cloudflare R2 ready (bucket: ${cached.bucket})`);
  return cached;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function toBuffer(data: Buffer | Uint8Array | string): Buffer {
  if (typeof data === "string") return Buffer.from(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/**
 * Upload an object to R2. Returns the storage KEY as `url` for backward
 * compatibility with existing callers/rows: the key is what gets persisted,
 * and storageGet() turns it into a fresh presigned URL on demand. Storing a
 * key (not a signed URL) is deliberate — signed URLs expire, keys don't.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const { client, bucket } = getClient();
  const key = normalizeKey(relKey);
  const body = toBuffer(data);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return { key, url: key };
}

/** Short-lived presigned download URL for a stored object. */
export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const { client, bucket } = getClient();
  const key = normalizeKey(relKey);
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  });
  return { key, url };
}

/** Best-effort delete (used when an admin removes a document). */
export async function storageDelete(relKey: string): Promise<void> {
  try {
    const { client, bucket } = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: normalizeKey(relKey) }));
  } catch (error) {
    console.error("[Storage] Delete failed (non-fatal):", error);
  }
}
