// api/delete-account/index.js
const { sql } = require("../../lib/neon.js");
const { s3, BUCKET } = require("../../lib/s3.js");
const {
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");

module.exports = async (req, res) => {
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

  let userId = null;
  try {
    const { data: user } = await sql`SELECT id FROM users WHERE auth_token = ${auth} LIMIT 1`;
    if (user?.[0]) userId = user[0].id;
  } catch {}

  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const uid = userId;

  let orphans = [];
  let continuationToken;
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
    orphans = orphans.concat(contents.map((c) => c.Key));
    continuationToken = resList.NextContinuationToken;
  } while (continuationToken);

  if (orphans.length) {
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
