// supabase/functions/_shared/supabase.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Resolve the calling user from the Authorization bearer token. */
export async function userFromAuthHeader(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error ? null : user;
}

/** Fixed-window rate limit: max `limit` calls per user per `windowMs`. */
export async function rateLimit(
  userId: string, action: "extract" | "draft_email",
  limit = 20, windowMs = 3_600_000,
): Promise<boolean> {
  const supabase = serviceClient();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", since);
  if ((count ?? 0) >= limit) return false;
  await supabase.from("ai_usage").insert({ user_id: userId, action });
  return true;
}
