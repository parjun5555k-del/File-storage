// api/process-document/index.js
const { corsHeaders } = require("../../lib/cors.js");
const { sql } = require("../../lib/neon.js");
const { downloadFile } = require("../../lib/s3.js");
const {
  validateExtraction,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_RESPONSE_SCHEMA,
} = require("../../lib/guardrails.js");
const { rateLimit } = require("../../lib/ratelimit.js");

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const MAX_RETRIES = 1;

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

  try {
    const { data: profile } = await sql`SELECT ai_consent_at FROM profiles WHERE user_id = ${userId}`;
    if (!profile?.[0]?.ai_consent_at) {
      return res.status(403).json({ error: "ai_consent_required" });
    }
  } catch {
    return res.status(403).json({ error: "ai_consent_required" });
  }

  const limited = await rateLimit(userId, "extract");
  if (!limited) {
    return res.status(429).json({ error: "rate_limited" });
  }

  let claimed;
  try {
    const updated = await sql`
      UPDATE documents SET status = 'processing'
      WHERE id = ${document_id} AND user_id = ${userId}
      AND status IN ('uploaded', 'failed')
      RETURNING id
    `;
    claimed = updated;
  } catch { claimed = []; }

  if (!claimed?.length) {
    return res.status(409).json({ error: "already_processing" });
  }

  try {
    const { data: doc } = await sql`SELECT id, storage_path, file_type, user_id FROM documents WHERE id = ${document_id}`;
    if (!doc?.[0] || doc[0].user_id !== userId) {
      return res.status(404).json({ error: "not_found" });
    }

    const bytes = await downloadFile(doc[0].storage_path);
    const inlineData = {
      inlineData: {
        mimeType: doc[0].file_type,
        data: Buffer.from(bytes).toString("base64"),
      },
    };

    let extraction = null;
    for (let attempt = 0; attempt <= MAX_RETRIES && !extraction; attempt++) {
      const resGemini = await callGemini(inlineData);
      if (!resGemini.ok) continue;
      const parsed = await resGemini.json();
      const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      try {
        const candidate = validateExtraction(JSON.parse(text));
        if (candidate) extraction = candidate;
      } catch {}
    }

    if (!extraction) {
      await sql`UPDATE documents SET status = 'failed' WHERE id = ${document_id}`;
      return res.status(200).json({ status: "failed", document_id });
    }

    await sql`
      UPDATE documents SET extracted = ${JSON.stringify(extraction)}::jsonb,
        document_type = ${extraction.document_type},
        category = ${extraction.category},
        suggested_filename = ${extraction.suggested_filename},
        status = 'needs_review'
      WHERE id = ${document_id}
    `;

    const warrantyRows = extraction.items.map((i) => ({
      user_id: userId,
      document_id,
      product_name: i.product_name,
      brand: i.brand,
      order_id: extraction.order_id,
      invoice_number: extraction.invoice_number,
      customer_name: extraction.customer_name,
      purchase_date: extraction.purchase_date,
      purchase_date_source: extraction.purchase_date ? "extracted" : null,
      warranty_start_date: i.warranty_start_date ?? extraction.purchase_date,
      warranty_start_source: i.warranty_start_date
        ? "extracted"
        : extraction.purchase_date ? "calculated" : null,
      duration_months: i.warranty_duration_months,
      expiry_date: i.warranty_expiry_date ?? null,
      expiry_source: i.warranty_expiry_date ? "extracted" : null,
      support_email: i.support_email,
      toll_free_number: i.toll_free_number,
      service_url: i.service_url,
    }));

    for (const row of warrantyRows) {
      await sql`
        INSERT INTO warranties (user_id, document_id, product_name, brand, order_id,
          invoice_number, customer_name, purchase_date, purchase_date_source,
          warranty_start_date, warranty_start_source, duration_months,
          expiry_date, expiry_source, support_email, toll_free_number, service_url)
        VALUES (${row.user_id}, ${row.document_id}, ${row.product_name}, ${row.brand},
          ${row.order_id}, ${row.invoice_number}, ${row.customer_name},
          ${row.purchase_date}, ${row.purchase_date_source},
          ${row.warranty_start_date}, ${row.warranty_start_source},
          ${row.duration_months}, ${row.expiry_date}, ${row.expiry_source},
          ${row.support_email}, ${row.toll_free_number}, ${row.service_url})
      `;
    }

    console.log(JSON.stringify({ fn: "process-document", document_id, status: "needs_review" }));

    return res.status(200).json({
      status: "needs_review",
      document_id,
      field_confidence: extraction.field_confidence,
    });
  } catch (e) {
    console.error(JSON.stringify({ fn: "process-document", document_id, status: "error" }));
    try { await sql`UPDATE documents SET status = 'failed' WHERE id = ${document_id}`; } catch {}
    return res.status(200).json({ status: "failed", document_id });
  }
};

async function callGemini(inlineData) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: "Extract structured data from this document." }, inlineData] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: EXTRACTION_RESPONSE_SCHEMA },
    }),
  });
}
