// api/delete-document/index.js
const { sql } = require("../../lib/neon.js");
const { deleteFile } = require("../../lib/s3.js");

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

  const { document_id } = req.body || {};
  if (!document_id) {
    return res.status(400).json({ error: "document_id required" });
  }

  let doc;
  try {
    const { data: rows } = await sql`
      SELECT id, user_id, storage_path FROM documents WHERE id = ${document_id}
    `;
    doc = rows?.[0];
  } catch {}

  if (!doc || doc.user_id !== userId) {
    return res.status(404).json({ error: "not_found" });
  }

  try {
    await deleteFile(doc.storage_path);
  } catch {
    return res.status(500).json({ error: "storage_delete_failed" });
  }

  try {
    await sql`DELETE FROM documents WHERE id = ${document_id}`;
  } catch {
    return res.status(500).json({ error: "row_delete_failed" });
  }

  console.log(JSON.stringify({ fn: "delete-document", document_id, status: "ok" }));
  return res.status(200).json({ status: "deleted", document_id });
}
