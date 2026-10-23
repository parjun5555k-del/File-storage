// supabase/functions/draft-warranty-email/index.ts
// Drafts subject + body only. App sends manually via expo-mail-composer.
import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient, userFromAuthHeader, rateLimit } from "../_shared/supabase.ts";
import { EMAIL_SYSTEM_PROMPT } from "../_shared/guardrails.ts";
import { warrantyStatus } from "../_shared/expiry.ts";

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return Response.json({ error: "POST only" }, { status: 405, headers: corsHeaders });

  const user = await userFromAuthHeader(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });

  const { warranty_id, issue_text } = await req.json().catch(() => ({}));
  if (!warranty_id || !issue_text?.trim())
    return Response.json({ error: "warranty_id and issue_text required" },
      { status: 400, headers: corsHeaders });

  const supabase = serviceClient();

  if (!(await rateLimit(user.id, "draft_email")))
    return Response.json({ error: "rate_limited" }, { status: 429, headers: corsHeaders });

  const { data: w } = await supabase
    .from("warranties")
    .select("*, documents!inner(user_id)")
    .eq("id", warranty_id)
    .single();
  if (!w || w.documents.user_id !== user.id)
    return Response.json({ error: "not_found" }, { status: 404, headers: corsHeaders });

  // Status is computed at read time, never stored.
  const status = warrantyStatus(w.expiry_date);

  // Missing-detail flags drive the app's banner — designer requirement.
  const missing: string[] = [];
  if (!w.support_email) missing.push("support_email");
  if (!w.brand && !w.product_name) missing.push("product_or_brand");
  if (!w.purchase_date) missing.push("purchase_date");
  if (!w.order_id && !w.invoice_number) missing.push("order_or_invoice_id");

  const facts = {
    product_name: w.product_name, brand: w.brand,
    order_id: w.order_id, invoice_number: w.invoice_number,
    customer_name: w.customer_name, purchase_date: w.purchase_date,
    warranty_start_date: w.warranty_start_date,
    duration_months: w.duration_months, expiry_date: w.expiry_date,
    warranty_status: status, seller: null, // seller lives on documents.extracted
    issue: issue_text.trim(),
  };
  const { data: doc } = await supabase
    .from("documents").select("extracted").eq("id", w.document_id).single();
  (facts as any).seller = doc?.extracted?.seller ?? null;

  let subject = `Warranty claim${w.brand ? ` — ${w.brand}` : ""}${w.product_name ? ` ${w.product_name}` : ""}`;
  let body =
    `Dear Support Team,\n\nI am writing to claim warranty service for the ` +
    `product below.\n\nProduct: ${[w.brand, w.product_name].filter(Boolean).join(" ") || "(to add)"}\n` +
    `Purchase date: ${w.purchase_date ?? "(to add)"}\n` +
    `${w.order_id ? `Order ID: ${w.order_id}\n` : ""}` +
    `${w.invoice_number ? `Invoice #: ${w.invoice_number}\n` : ""}` +
    `Issue: ${facts.issue}\n\n` +
    (status === "expired" || status === "unknown"
      ? "Please confirm whether this product is eligible for warranty service.\n\n"
      : "This product is within its warranty period and I would appreciate your assistance.\n\n`) +
    `Kind regards,\n${w.customer_name ?? "(your name)"}`;

  // Try Gemini once; on failure fall back to the deterministic local draft above.
  try {
    const key = Deno.env.get("GEMINI_API_KEY");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: EMAIL_SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: `Facts JSON:\n${JSON.stringify(facts)}` }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      });
    if (res.ok) {
      const parsed = await res.json();
      const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        if (typeof j.subject === "string") subject = j.subject;
        if (typeof j.body === "string") body = j.body;
        if (Array.isArray(j.missing_fields)) missing.push(...j.missing_fields.filter((x: unknown) => typeof x === "string"));
      }
    }
  } catch { /* keep local draft */ }

  console.log(JSON.stringify({ fn: "draft-warranty-email", warranty_id, status: "ok" }));
  return Response.json(
    { subject, body, missing_fields: [...new Set(missing)] },
    { status: 200, headers: corsHeaders });
});
