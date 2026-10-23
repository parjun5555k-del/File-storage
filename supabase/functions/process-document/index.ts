// supabase/functions/process-document/index.ts
// The ONLY path from user files to Gemini. Key never leaves this function.
import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient, userFromAuthHeader, rateLimit } from "../_shared/supabase.ts";
import {
  validateExtraction, redactUnverifiedContacts,
  EXTRACTION_SYSTEM_PROMPT, EXTRACTION_RESPONSE_SCHEMA,
} from "../_shared/guardrails.ts";

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash"; // confirm in AI Studio
const MAX_RETRIES = 1;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return Response.json({ error: "POST only" }, { status: 405, headers: corsHeaders });

  const user = await userFromAuthHeader(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });

  const { document_id } = await req.json().catch(() => ({}));
  if (!document_id)
    return Response.json({ error: "document_id required" }, { status: 400, headers: corsHeaders });

  const supabase = serviceClient();

  // 1) Ownership + consent check.
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id,user_id,storage_path,file_type,status")
    .eq("id", document_id)
    .single();
  if (docErr || !doc || doc.user_id !== user.id)
    return Response.json({ error: "not_found" }, { status: 404, headers: corsHeaders });

  const { data: profile } = await supabase
    .from("profiles").select("ai_consent_at").eq("user_id", user.id).single();
  if (!profile?.ai_consent_at)
    return Response.json({ error: "ai_consent_required" }, { status: 403, headers: corsHeaders });

  // 2) Rate limit: 20 extractions / hour / user.
  if (!(await rateLimit(user.id, "extract")))
    return Response.json({ error: "rate_limited" }, { status: 429, headers: corsHeaders });

  // 3) Mark processing (idempotency: refuse if already mid-flight).
  const { data: claimed } = await supabase
    .from("documents")
    .update({ status: "processing" })
    .eq("id", document_id)
    .in("status", ["uploaded", "failed"])
    .select("id");
  if (!claimed?.length)
    return Response.json({ error: "already_processing" }, { status: 409, headers: corsHeaders });

  try {
    // 4) Download original from private bucket.
    const { data: file, error: dlErr } = await supabase.storage
      .from("documents").download(doc.storage_path);
    if (dlErr || !file) throw new Error("file_download_failed");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const inlineData = {
      inlineData: {
        mimeType: doc.file_type,
        data: btoa(String.fromCharCode(...bytes)), // < ~10MB so inline is fine
      },
    };

    // 5) Gemini with structured output, temperature 0, one retry.
    let extraction = null;
    for (let attempt = 0; attempt <= MAX_RETRIES && !extraction; attempt++) {
      const res = await callGemini(inlineData);
      if (!res.ok) continue;
      const parsed = await res.json();
      const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      try {
        const candidate = validateExtraction(JSON.parse(text));
        if (candidate) extraction = redactUnverifiedContacts(candidate);
      } catch { /* retry */ }
    }

    if (!extraction) {
      await supabase.from("documents")
        .update({ status: "failed" }).eq("id", document_id);
      return Response.json({ status: "failed", document_id },
        { status: 200, headers: corsHeaders }); // 200: app offers manual entry path
    }

    // 6) Persist. Contact details only ever land here via the guardrail.
    await supabase.from("documents").update({
      extracted: extraction,
      document_type: extraction.document_type,
      category: extraction.category,
      suggested_filename: extraction.suggested_filename,
      status: "needs_review",
    }).eq("id", document_id);

    // One warranties row per product. Dates have sources; expiry left for the
    // review screen / calculateExpiry (never trusted from the model unless stated).
    const warrantyRows = extraction.items.map(i => ({
      user_id: user.id,
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
        ? "extracted" : (extraction.purchase_date ? "calculated" : null),
      duration_months: i.warranty_duration_months,
      expiry_date: i.warranty_expiry_date ?? null, // only if the document STATED it
      expiry_source: i.warranty_expiry_date ? "extracted" : null,
      support_email: i.support_email,
      toll_free_number: i.toll_free_number,
      service_url: i.service_url,
    }));
    await supabase.from("warranties").insert(warrantyRows);

    // 7) Log IDs and status only — never document text.
    console.log(JSON.stringify({ fn: "process-document", document_id, status: "needs_review" }));

    return Response.json(
      { status: "needs_review", document_id, field_confidence: extraction.field_confidence },
      { status: 200, headers: corsHeaders });
  } catch (e) {
    console.log(JSON.stringify({ fn: "process-document", document_id, status: "error" }));
    await supabase.from("documents").update({ status: "failed" }).eq("id", document_id);
    return Response.json({ status: "failed", document_id },
      { status: 200, headers: corsHeaders });
  }
});

async function callGemini(inlineData: { inlineData: { mimeType: string; data: string } }) {
  const key = Deno.env.get("GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${MODEL}:generateContent?key=${key}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: "Extract structured data from this document." }, inlineData] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: EXTRACTION_RESPONSE_SCHEMA,
      },
    }),
  });
}
