// lib/ratelimit.js
const { sql } = require("./neon.js");

async function rateLimit(userId, action, limit = 20, windowMs = 3_600_000) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data: rows } = await sql`
    SELECT COUNT(*) AS cnt
    FROM ai_usage
    WHERE user_id = ${userId}
      AND action = ${action}
      AND created_at >= ${since}
  `;
  const count = Number(rows?.[0]?.cnt ?? 0);
  if (count >= limit) return false;
  await sql`
    INSERT INTO ai_usage (user_id, action)
    VALUES (${userId}, ${action})
  `;
  return true;
}

exports.rateLimit = rateLimit;
