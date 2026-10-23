// __tests__/guardrails.test.ts  (Deno: run with `deno test supabase/functions/`)
// import { validateExtraction } from "../supabase/functions/_shared/guardrails.ts";
//
// Deno.test("drops contact details not present in OCR text", () => {
//   const raw = {
//     items: [{
//       product_name: "Air Fryer", brand: "Acme",
//       support_email: "fake@scam.example",          // invented -> must be dropped
//       toll_free_number: "1-800-555-0199",          // invented -> dropped
//     }],
//     field_confidence: { brand: "high" },
//   };
//   const ext = validateExtraction(raw);
//   if (!ext) throw new Error("should parse");
//   if (ext.items[0].support_email !== null) throw new Error("email not dropped");
//   if (ext.items[0].toll_free_number !== null) throw new Error("phone not dropped");
// });
