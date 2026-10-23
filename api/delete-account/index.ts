// api/delete-account/index.ts
// Full erasure: files -> rows -> auth user.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../../lib/neon.ts";
import { s3, BUCKET, listFiles, deleteFile } from "../../lib/s3.ts";
import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end("ok");
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!auth) {
    return res.status(401).json({ error: "unauthorized" });
  }
  let userId: string | null = null;
  try {
    const { data: user } = await sql`SELECT id FROM users WHERE auth_token = ${auth} LIMIT 1`;
    if (user?.[0]) userId = user[0].id as string;
  } catch {}
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const uid = userId;

  // 1) Delete every storage object under {uid}/ — list in pages of 1000.
  let orphans: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resList = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `${uid}/`,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
    );
    const contents = resList.Contents ?? [];
    if (contents.length === 0) break;
    orphans = orphans.concat(contents.map((c) => c.Key!));
    continuationToken = resList.NextContinuationToken;
  } while (continuationToken);

  if (orphans.length) {
    // Delete in batches of 1000 (S3 API limit)
    for (let i = 0; i < orphans.length; i += 1000) {
      const batch = orphans.slice(i, i + 1000);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        })
      );
    }
  }

  // 2) Delete all rows.
  try {
    await sql`DELETE FROM warranties WHERE user_id = ${uid}`;
    await sql`DELETE FROM documents WHERE user_id = ${uid}`;
    await sql`DELETE FROM ai_usage WHERE user_id = ${uid}`;
    await sql`DELETE FROM profiles WHERE user_id = ${uid}`;
    await sql`DELETE FROM users WHERE id = ${uid}`;
  } catch {}

  console.log(JSON.stringify({ fn: "delete-account", user_id: uid, status: "ok" }));
  return res.status(200).json({ status: "deleted" });
}
