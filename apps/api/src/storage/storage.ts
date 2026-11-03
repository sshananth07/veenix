import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  PutBucketCorsCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CONTENT_TYPES, MAX_UPLOAD_BYTES, UPLOAD_RULES, type PresignInput, type UploadPurpose } from "@veenix/shared";
import { env } from "../config/env";
import { ctx } from "../common/context";
import { rule } from "../common/errors";

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});
const Bucket = env.S3_BUCKET;

export function newKey(purpose: UploadPurpose | "documents" | "assistant", ext: string) {
  return `orgs/${ctx().orgId}/${purpose}/${randomUUID()}${ext}`;
}

export async function presignUpload(input: PresignInput) {
  const ext = extname(input.filename).toLowerCase();
  if (!UPLOAD_RULES[input.purpose].exts.includes(ext)) throw rule(UPLOAD_RULES[input.purpose].label);
  const key = newKey(input.purpose, ext);
  const contentType = CONTENT_TYPES[ext];
  // Content type and length are signed: the browser must PUT exactly this file.
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: input.size }), { expiresIn: 300 });
  return { key, url, contentType };
}

const startsWith = (b: Buffer, bytes: number[]) => bytes.every((v, i) => b[i] === v);
const zip = (b: Buffer) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
const ole = (b: Buffer) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const jpeg = (b: Buffer) => startsWith(b, [0xff, 0xd8, 0xff]);
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  ".pdf": (b) => b.subarray(0, 4).toString("latin1") === "%PDF",
  ".png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ".jpg": jpeg,
  ".jpeg": jpeg,
  ".webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  ".docx": zip,
  ".xlsx": zip,
  ".doc": ole,
  ".xls": ole,
};

async function readStart(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key: key, Range: "bytes=0-15" }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

/** Accepts a file the browser uploaded, after checking it really belongs here and really is what its name says. */
export async function claim(ref: { key: string; name: string }, purpose: UploadPurpose) {
  const ext = extname(ref.key).toLowerCase();
  const prefix = `orgs/${ctx().orgId}/${purpose}/`;
  if (!ref.key.startsWith(prefix) || !/^[0-9a-f-]{36}$/.test(basename(ref.key, ext)) || !UPLOAD_RULES[purpose].exts.includes(ext)) {
    throw rule(UPLOAD_RULES[purpose].label);
  }
  const head = await s3.send(new HeadObjectCommand({ Bucket, Key: ref.key })).catch(() => null);
  if (!head) throw rule("The upload didn't finish. Try again.");
  const size = head.ContentLength ?? 0;
  if (size > MAX_UPLOAD_BYTES) {
    await removeObject(ref.key);
    throw rule("File is larger than 10 MB");
  }
  if (!MAGIC[ext](await readStart(ref.key))) {
    await removeObject(ref.key);
    throw rule(`"${ref.name}" is not a real ${ext.slice(1).toUpperCase()} file`);
  }
  return { path: ref.key, name: ref.name.slice(0, 120), size, contentType: CONTENT_TYPES[ext] };
}

const disposition = (filename: string, inline: boolean) =>
  `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.\- ]+/g, "_")}"`;

export function downloadUrl(key: string, filename: string, inline = true) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition(filename, inline) }), { expiresIn: 300 });
}

/** A 7-day link for sending a document over WhatsApp. */
export function shareUrl(key: string, filename: string) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition(filename, true) }), { expiresIn: 604_800 });
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

/** Throws on failure; deleting a key that's already gone succeeds. */
export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
}

/** Best effort: a failure is ignored. */
export async function removeObject(key: string) {
  await deleteObject(key).catch(() => undefined);
}

/** Local and first-deploy setup: create the bucket and let the web origin PUT and GET directly. */
export async function ensureBucket() {
  const exists = await s3.send(new HeadBucketCommand({ Bucket })).then(() => true, () => false);
  if (!exists) await s3.send(new CreateBucketCommand({ Bucket }));
  await s3
    .send(new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: { CORSRules: [{ AllowedOrigins: [env.WEB_ORIGIN], AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["*"], MaxAgeSeconds: 3000 }] },
    }))
    .catch((e) => console.warn(`Bucket CORS not set (${e.name}). If browser uploads fail with a CORS error, see plan 05 Task 5.1 Step 5.`));
}
