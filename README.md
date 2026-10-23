# WarrantyVault — Backend (Vercel + Neon)

This is the WarrantyVault backend adapted for **Vercel serverless functions** with **Neon Postgres** as the database and **Neon S3** as file storage.

## Architecture

| Layer | Technology |
|-------|-----------|
| API / Serverless | Vercel (Node.js 18+) |
| Database | Neon Postgres (serverless) |
| File Storage | Neon S3 (S3-compatible endpoint) |
| AI | Google Gemini API (called from serverless functions only) |

## Directory Layout

```
api/
  process-document/index.ts   — file → Gemini extraction → Neon
  draft-warranty-email/index.ts — draft claim email (no auto-send)
  delete-document/index.ts    — delete S3 object + DB row
  delete-account/index.ts     — full erasure: files, rows, user
lib/
  neon.ts                     — Neon Postgres client
  s3.ts                       — Neon S3 client (AWS SDK v3)
  guardrails.ts               — extraction validation + anti-fabrication guardrails
  expiry.ts                   — date calculation engine (shared with app)
  ratelimit.ts                — fixed-window rate limiter (20/hr/user)
  cors.ts                     — CORS helpers
database/
  schema.sql                  — Neon Postgres schema
.env.example                  — copy to .env and fill in values
vercel.json                   — Vercel deployment config
```

## Environment Variables

Copy `.env.example` to `.env` and set:

```
DATABASE_URL=postgresql://<user>:<pass>@<neon-host>/<db>?sslmode=require
AWS_ENDPOINT_URL_S3=https://br-raspy-waterfall-b441uple.storage.c-6.us-east-2.aws.neon.tech
AWS_ACCESS_KEY_ID=nak_live_906dec95cba1485bb5a2e5306e6bd610
AWS_SECRET_ACCESS_KEY=nsk_live_7545f56d83fe0307bea5b2e122a2090b93db6f4fde2da9fc27cadf6f70f19e1e
AWS_REGION=us-east-2
S3_BUCKET=documents
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

## Database Setup

Run `database/schema.sql` against your Neon Postgres database to create tables, enums, and indexes.

## Deploy to Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Link your project: `vercel login` → `vercel link`
3. Add secrets: `vercel secrets add DATABASE_URL "..."` (or set in Vercel dashboard)
4. Deploy: `vercel --prod`

Or connect your GitHub repo to Vercel for automatic deploys on push.

## Security Notes

- The Gemini API key lives only in Vercel environment variables (never in the app bundle).
- All file paths use `{user_id}/{document_id}/original.ext` in Neon S3.
- Signed URLs are generated at view time via `getSignedDownloadUrl()` and never stored.
- Rate limit: 20 extractions + 20 drafts per user per hour.
- Contact details (email/phone/URL) are dropped unless they appear verbatim in the document OCR text.
