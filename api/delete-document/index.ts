// api/delete-document/index.ts
// Order matters: Neon S3 object first, then row (cascades to warranties).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../../lib/neon.ts";
import { deleteFile } from "../../lib/s3.ts";

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

  const { document_id } = (req.body ?? {}) as { document_id?: string };
  if (!document_id) {
    return res.status(400).json({ error: "document_id required" });
  }

  let doc: any;
  try {
    const { data: rows } = await sql`
      SELECT id, user_id, storage_path FROM documents WHERE id = ${document_id}
    `;
    doc = rows?.[0];
  } catch {}
  if (!doc || doc.user_id !== userId) {
    return res.status(404).json({ error: "not_found" });
  }

  // 1) Remove the file from Neon S3. Warranties row deletion cascades with the document row.
  try {
    await deleteFile(doc.storage_path as string);
  } catch {
    return res.status(500).json({ error: "storage_delete_failed" });
  }

  // 2) Remove the row — warranties cascade via ON DELETE CASCADE.
  try {
    await sql`DELETE FROM documents WHERE id = ${document_id}`;
  } catch {
    return res.status(500).json({ error: "row_delete_failed" });
  }

  console.log(JSON.stringify({ fn: "delete-document", document_id, status: "ok" }));
  return res.status(200).json({ status: "deleted", document_id });
}
