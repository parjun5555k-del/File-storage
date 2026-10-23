// api/draft-warranty-email/index.js
const { corsHeaders } = require("../../lib/cors.js");
const { sql } = require("../../lib/neon.js");
const { rateLimit } = require("../../lib/ratelimit.js");
const { EMAIL_SYSTEM_PROMPT } = require("../../lib/guardrails.js");
const { warrantyStatus } = require("../../lib/expiry.js");

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

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

  const { warranty_id, issue_text } = req.body || {};
  if (!warranty_id || !issue_text?.trim()) {
    return res.status(400).json({ error: "warranty_id and issue_text required" });
  }

  const limited = await rateLimit(userId, "draft_email");
  if (!limited) {
    return res.status(429).json({ error: "rate_limited" });
  }

  let w;
  try {
    const { data: rows } = await sql`
      SELECT w.*, d.user_id
      FROM warranties w
      JOIN documents d ON d.id = w.document_id
      WHERE w.id = ${warranty_id}
    `;
    w = rows?.[0];
  } catch {}

  if (!w || w.user_id !== userId) {
    return res.status(404).json({ error: "not_found" });
  }

  const status = warrantyStatus(w.expiry_date);

  const missing = [];
  if (!w.support_email) missing.push("support_email");
  if (!w.brand && !w.product_name) missing.push("product_or_brand");
  if (!w.purchase_date) missing.push("purchase_date");
  if (!w.order_id && !w.invoice_number) missing.push("order_or_invoice_id");

  const facts = {
    product_name: w.product_name,
    brand: w.brand,
    order_id: w.order_id,
    invoice_number: w.invoice_number,
    customer_name: w.customer_name,
    purchase_date: w.purchase_date,
    warranty_start_date: w.warranty_start_date,
    duration_months: w.duration_months,
    expiry_date: w.expiry_date,
    warranty_status: status,
    seller: null,
    issue: issue_text.trim(),
  };

  try {
    const { data: docRows } = await sql`SELECT extracted FROM documents WHERE id = ${w.document_id}`;
    const seller = docRows?.[0]?.extracted?.seller ?? null;
    facts.seller = seller;
  } catch {}

  let subject = `Warranty claim${w.brand ? ` — ${w.brand}` : ""}${
    w.product_name ? ` ${w.product_name}` : ""
  }`;
  let body =
    `Dear Support Team,\n\nI am writing to claim warranty service for the ` +
    `product below.\n\nProduct: ${[w.brand, w.product_name]
      .filter(Boolean)
      .join(" ") || "(to add)"}\n` +
    `Purchase date: ${w.purchase_date ?? "(to add)"}\n` +
    `${w.order_id ? `Order ID: ${w.order_id}\n` : ""}` +
    `${w.invoice_number ? `Invoice #: ${w.invoice_number}\n` : ""}` +
    `Issue: ${facts.issue}\n\n` +
    (status === "expired" || status === "unknown"
      ? "Please confirm whether this product is eligible for warranty service.\n\n"
      : "This product is within its warranty period and I would appreciate your assistance.\n\n") +
    `Kind regards,\n${w.customer_name ?? "(your name)"}`;

  try {
    const key = process.env.GEMINI_API_KEY;
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: EMAIL_SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: `Facts JSON:\n${JSON.stringify(facts)}` }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      }
    );
    if (geminiRes.ok) {
      const parsed = await geminiRes.json();
      const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        if (typeof j.subject === "string") subject = j.subject;
        if (typeof j.body === "string") body = j.body;
        if (Array.isArray(j.missing_fields)) {
          missing.push(
            ...j.missing_fields.filter((x) => typeof x === "string")
          );
        }
      }
    }
  } catch {}

  console.log(JSON.stringify({ fn: "draft-warranty-email", warranty_id, status: "ok" }));
  return res.status(200).json({
    subject,
    body,
    missing_fields: [...new Set(missing)],
  });
}
