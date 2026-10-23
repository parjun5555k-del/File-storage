-- WarrantyVault · Neon Postgres schema
-- Adapted from Supabase 0001_init.sql for Neon (Postgres-compatible).
-- Note: Neon S3 is used for file storage instead of Supabase Storage.

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type processing_status as enum
  ('uploaded','processing','needs_review','confirmed','failed');

create type date_source as enum
  ('extracted','calculated','user_entered');

-- ---------- Users (simple auth for v1.0) ----------
create table users (
  id        uuid primary key default gen_random_uuid(),
  email     text unique not null,
  password_hash text not null,
  auth_token text unique, -- set after sign-in; sent as Bearer token
  created_at timestamptz default now()
);

-- ---------- Profiles ----------
create table profiles (
  user_id        uuid primary key references users(id) on delete cascade,
  ai_consent_at  timestamptz,
  created_at     timestamptz default now()
);

-- ---------- Documents ----------
create table documents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  original_filename text not null,
  suggested_filename text,
  display_name      text,
  category          text,
  document_type     text,
  file_type         text not null check (file_type in
                    ('image/jpeg','image/png','application/pdf')),
  file_size_bytes   int  not null check (file_size_bytes <= 10485760),
  storage_path      text not null, -- Neon S3 key: {user_id}/{document_id}/original.ext
  extracted         jsonb default '{}'::jsonb,
  status            processing_status not null default 'uploaded',
  created_at        timestamptz default now(),
  search tsvector generated always as (
    to_tsvector('simple',
      coalesce(display_name,'')        || ' ' ||
      coalesce(suggested_filename,'')  || ' ' ||
      coalesce(category,'')            || ' ' ||
      coalesce(document_type,'')       || ' ' ||
      coalesce(extracted->>'brand','') || ' ' ||
      coalesce(extracted->>'seller','')|| ' ' ||
      coalesce(extracted->>'order_id',''))
  ) stored
);

create index on documents using gin (search);
create index on documents (user_id, created_at desc);

-- ---------- Warranties (many per document) ----------
create table warranties (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  document_id          uuid not null references documents(id) on delete cascade,
  product_name         text,
  brand                text,
  order_id             text,
  invoice_number       text,
  customer_name        text,
  purchase_date        date,
  purchase_date_source date_source,
  warranty_start_date  date,
  warranty_start_source date_source,
  duration_months      int check (duration_months between 1 and 120),
  expiry_date          date,
  expiry_source        date_source,
  support_email        text,
  toll_free_number     text,
  service_url          text,
  created_at           timestamptz default now()
);

create index on warranties (user_id, expiry_date);
create index on warranties (document_id);

-- ---------- AI usage log (rate limiting + audit) ----------
create table ai_usage (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references users(id) on delete cascade,
  action      text not null check (action in ('extract','draft_email')),
  document_id uuid,
  created_at  timestamptz default now()
);

create index on ai_usage (user_id, action, created_at desc);
