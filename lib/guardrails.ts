// lib/guardrails.ts — Server-side validation & guardrails after every Gemini call.
// Adapted from supabase/functions/_shared/guardrails.ts for Vercel + Neon.

export interface ExtractionItem {
  product_name: string;
  brand: string | null;
  warranty_duration_months: number | null;
  warranty_start_date: string | null;
  warranty_expiry_date: string | null;
  support_email: string | null;
  toll_free_number: string | null;
  service_url: string | null;
}

export interface Extraction {
  document_type: string | null;
  category: string | null;
  suggested_filename: string | null;
  seller: string | null;
  customer_name: string | null;
  invoice_number: string | null;
  order_id: string | null;
  purchase_date: string | null;
  date_ambiguous: boolean;
  total_price: { amount: number | null; currency: string | null } | null;
  items: ExtractionItem[];
  field_confidence: Record<string, "high" | "medium" | "low">;
}

const DOC_TYPES = ["invoice","receipt","warranty_card","bill","purchase_confirmation","other"];
const CATEGORIES = ["Electronics","Appliances","Furniture","Vehicle","Other"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validDateOrNull(v: unknown): string | null {
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}

export function validMonthsOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 120 ? v : null;
}

export function validateExtraction(raw: unknown): Extraction | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  const items: ExtractionItem[] = Array.isArray(j.items) ? (j.items as any[])
    .filter(i => i && typeof i === "object" && typeof (i as any).product_name === "string")
    .map(i => ({
      product_name: (i as any).product_name,
      brand: typeof (i as any).brand === "string" ? (i as any).brand : null,
      warranty_duration_months: validMonthsOrNull((i as any).warranty_duration_months),
      warranty_start_date: validDateOrNull((i as any).warranty_start_date),
      warranty_expiry_date: validDateOrNull((i as any).warranty_expiry_date),
      support_email: null, toll_free_number: null, service_url: null,
      ...contactGuardrail(i as Record<string, unknown>, j),
    })) : [];

  const ext: Extraction = {
    document_type: DOC_TYPES.includes(j.document_type as string) ? j.document_type as string : null,
    category: CATEGORIES.includes(j.category as string) ? j.category as string : null,
    suggested_filename: typeof j.suggested_filename === "string" ? j.suggested_filename : null,
    seller: typeof j.seller === "string" ? j.seller : null,
    customer_name: typeof j.customer_name === "string" ? j.customer_name : null,
    invoice_number: typeof j.invoice_number === "string" ? j.invoice_number : null,
    order_id: typeof j.order_id === "string" ? j.order_id : null,
    purchase_date: validDateOrNull(j.purchase_date),
    date_ambiguous: j.date_ambiguous === true,
    total_price: (j.total_price && typeof j.total_price === "object")
      ? { amount: typeof (j.total_price as any).amount === "number" ? (j.total_price as any).amount : null,
          currency: typeof (j.total_price as any).currency === "string" ? (j.total_price as any).currency : null }
      : null,
    items,
    field_confidence: (j.field_confidence && typeof j.field_confidence === "object")
      ? j.field_confidence as Extraction["field_confidence"] : {},
  };
  return items.length > 0 ? ext : null;
}

/**
 * HARD GUARDRAIL: drop any support email / phone / URL that does not appear
 * verbatim in the OCR text. Anti-fabrication wall for contact data.
 */
function contactGuardrail(item: Record<string, unknown>, doc: Record<string, unknown>) {
  const hay = JSON.stringify(doc).toLowerCase();
  const keep = (v: unknown) =>
    typeof v === "string" && v.length > 0 && hay.includes(v.toLowerCase()) ? v : null;
  return {
    support_email: keep(item.support_email),
    toll_free_number: keep(item.toll_free_number),
    service_url: keep(item.service_url),
  };
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured data from purchase and warranty documents.
Rules:
1. Return only fields explicitly present in the document. If absent, return null. Never guess.
2. Dates must be ISO 8601 (YYYY-MM-DD). If a date is ambiguous (e.g. 03/04/2026), put raw text in date_raw and set date_ambiguous=true.
3. Report warranty_expiry_date only if the document states an expiry date.
4. Report warranty_duration_months only if stated. Convert years to months.
5. Never produce a support email, phone number or URL that is not printed in the document.
6. For each field return confidence: high | medium | low.
7. One invoice may list several products. Return one item per product in items[].
8. Suggest a filename: Brand_Product_DocType_DD-Mon-YYYY using only extracted values.`;

export const EXTRACTION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    document_type: { type: "STRING" },
    category: { type: "STRING" },
    suggested_filename: { type: "STRING" },
    seller: { type: "STRING" },
    customer_name: { type: "STRING" },
    invoice_number: { type: "STRING" },
    order_id: { type: "STRING" },
    purchase_date: { type: "STRING" },
    date_ambiguous: { type: "BOOLEAN" },
    total_price: {
      type: "OBJECT",
      properties: { amount: { type: "NUMBER" }, currency: { type: "STRING" } },
    },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          product_name: { type: "STRING" },
          brand: { type: "STRING" },
          warranty_duration_months: { type: "INTEGER" },
          warranty_start_date: { type: "STRING" },
          warranty_expiry_date: { type: "STRING" },
          support_email: { type: "STRING" },
          toll_free_number: { type: "STRING" },
          service_url: { type: "STRING" },
        },
        required: ["product_name"],
      },
    },
    field_confidence: { type: "OBJECT" },
  },
  required: ["items", "field_confidence"],
} as const;

export const EMAIL_SYSTEM_PROMPT = `Write a polite, concise warranty claim email. Use ONLY the facts in the JSON provided.
Do not invent contact details, dates, policy terms or promises of coverage.
If warranty_status is expired or unknown, do not claim the product is covered; ask the seller to confirm eligibility.
Return JSON: {"subject": string, "body": string, "missing_fields": string[]}.
List in missing_fields every detail the user must add.`;
