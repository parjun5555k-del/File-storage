// api/draft-warranty-email/index.ts
// Drafts subject + body only. App sends manually via expo-mail-composer.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { corsHeaders } from "../../lib/cors.ts";
import { sql } from "../../lib/neon.ts";
import { rateLimit } from "../../lib/ratelimit.ts";
import { EMAIL_SYSTEM_PROMPT } from "../../lib/guardrails.ts";
import { warrantyStatus } from "../../lib/expiry.ts";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

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

  const { warranty_id, issue_text } = (req.body ?? {}) as {
    warranty_id?: string;
    issue_text?: string;
  };
  if (!warranty_id || !issue_text?.trim()) {
    return res.status(400).json({ error: "warranty_id and issue_text required" });
  }

  const limited = await rateLimit(userId, "draft_email");
  if (!limited) {
    return res.status(429).json({ error: "rate_limited" });
  }

  let w: any;
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

  // Status computed at read time, never stored.
  const status = warrantyStatus(w.expiry_date);

  const missing: string[] = [];
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
    seller: null, // seller lives on documents.extracted
    issue: issue_text.trim(),
  };

  try {
    const { data: docRows } = await sql`
      SELECT extracted FROM documents WHERE id = ${w.document_id}
    `;
    const seller = docRows?.[0]?.extracted?.seller ?? null;
    (facts as any).seller = seller;
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

  // Try Gemini once; on failure fall back to the deterministic local draft above.
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
            ...j.missing_fields.filter((x: unknown) => typeof x === "string")
          );
        }
      }
    }
  } catch {
    /* keep local draft */
  }

  console.log(JSON.stringify({ fn: "draft-warranty-email", warranty_id, status: "ok" }));
  return res.status(200).json({
    subject,
    body,
    missing_fields: [...new Set(missing)],
  });
}
