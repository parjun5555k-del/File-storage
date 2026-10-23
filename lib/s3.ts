// lib/s3.ts — Neon S3 client (AWS SDK v3, S3-compatible endpoint)
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3 = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL_S3!,
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true, // required for S3-compatible endpoints like Neon
});

export const BUCKET = process.env.S3_BUCKET ?? "documents";

export async function downloadFile(key: string) {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );
  const chunks: Uint8Array[] = [];
  const body = res.Body as any;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function uploadFile(key: string, data: Buffer | Uint8Array, mimeType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: data,
      ContentType: mimeType,
    })
  );
}

export async function deleteFile(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function listFiles(prefix: string) {
  const res = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
  );
  return res.Contents ?? [];
}

export async function getSignedDownloadUrl(key: string, expiresIn = 3600) {
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn }
  );
  return url;
}
