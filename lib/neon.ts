// lib/neon.ts — Neon Postgres client (serverless)
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export { sql };

export async function getUserFromToken(token: string) {
  // Verify the user via Neon / auth. In v1.0, we expect the caller
  // to pass a user_id header or we validate against a sessions table.
  // For now, resolve user from a simple auth table or pass-through.
  return null;
}
