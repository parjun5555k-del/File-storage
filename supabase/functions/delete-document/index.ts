// supabase/functions/delete-document/index.ts
// Order matters: storage object first, then row (cascades to warranties).
import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient, userFromAuthHeader } from "../_shared/supabase.ts";

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

  const { data: doc } = await supabase
    .from("documents")
    .select("id,user_id,storage_path")
    .eq("id", document_id)
    .single();
  if (!doc || doc.user_id !== user.id)
    return Response.json({ error: "not_found" }, { status: 404, headers: corsHeaders });

  // 1) Remove the file. Warranties row deletion cascades with the document row.
  const { error: storageErr } = await supabase.storage
    .from("documents").remove([doc.storage_path]);
  if (storageErr)
    return Response.json({ error: "storage_delete_failed" },
      { status: 500, headers: corsHeaders });

  // 2) Remove the row — warranties cascade via ON DELETE CASCADE.
  const { error: rowErr } = await supabase
    .from("documents").delete().eq("id", document_id);
  if (rowErr)
    return Response.json({ error: "row_delete_failed" }, { status: 500, headers: corsHeaders });

  console.log(JSON.stringify({ fn: "delete-document", document_id, status: "ok" }));
  return Response.json({ status: "deleted", document_id },
    { status: 200, headers: corsHeaders });
});
