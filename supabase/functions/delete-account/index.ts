// supabase/functions/delete-account/index.ts
// Full erasure: files -> rows -> auth user. Service-role only, self-service.
import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient, userFromAuthHeader } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return Response.json({ error: "POST only" }, { status: 405, headers: corsHeaders });

  const user = await userFromAuthHeader(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });

  const supabase = serviceClient();
  const uid = user.id;

  // 1) Delete every storage object under {uid}/ — list in pages of 1000.
  let orphans: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: files } = await supabase.storage
      .from("documents").list(uid, { limit: 1000, offset });
    if (!files?.length) break;
    orphans = orphans.concat(files.map(f => `${uid}/${f.name}`));
  }
  if (orphans.length)
    await supabase.storage.from("documents").remove(orphans);

  // 2) Delete all rows (RLS would also allow this, but service-role is one round trip).
  await supabase.from("warranties").delete().eq("user_id", uid);
  await supabase.from("documents").delete().eq("user_id", uid);
  await supabase.from("ai_usage").delete().eq("user_id", uid);
  await supabase.from("profiles").delete().eq("user_id", uid);

  // 3) Delete the auth user itself.
  const { error: authErr } = await supabase.auth.admin.deleteUser(uid);
  if (authErr)
    return Response.json({ error: "auth_delete_failed", code: authErr.code },
      { status: 500, headers: corsHeaders });

  console.log(JSON.stringify({ fn: "delete-account", user_id: uid, status: "ok" }));
  return Response.json({ status: "deleted" }, { status: 200, headers: corsHeaders });
});
