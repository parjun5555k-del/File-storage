-- WarrantyVault · 0001_init.sql
-- Schema, enums, indexes, RLS, storage bucket + policies, signup trigger.
-- Everything is idempotent where Postgres allows.

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type processing_status as enum
  ('uploaded','processing','needs_review','confirmed','failed');

create type date_source as enum
  ('extracted','calculated','user_entered');

-- ---------- Profiles ----------
create table profiles (
  user_id        uuid primary key references auth.users on delete cascade,
  ai_consent_at  timestamptz,
  created_at     timestamptz default now()
);

-- ---------- Documents ----------
create table documents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  original_filename text not null,
  suggested_filename text,
  display_name      text,
  category          text,
  document_type     text,
  file_type         text not null check (file_type in
                    ('image/jpeg','image/png','application/pdf')),
  file_size_bytes   int  not null check (file_size_bytes <= 10485760),
  storage_path      text not null,
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
  user_id              uuid not null references auth.users on delete cascade,
  document_id          uuid not null references documents on delete cascade,
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
  user_id     uuid not null references auth.users on delete cascade,
  action      text not null check (action in ('extract','draft_email')),
  document_id uuid,
  created_at  timestamptz default now()
);

create index on ai_usage (user_id, action, created_at desc);

-- ---------- Row Level Security ----------
alter table profiles   enable row level security;
alter table documents  enable row level security;
alter table warranties enable row level security;
alter table ai_usage   enable row level security;

create policy own_profile on profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_docs on documents for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_warr on warranties for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_usage on ai_usage for select
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Private storage bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents','documents',false,10485760,
        array['image/jpeg','image/png','application/pdf'])
on conflict (id) do nothing;

-- Path layout: {user_id}/{document_id}/original.ext
create policy own_files on storage.objects for all
  using (bucket_id = 'documents'
     and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'documents'
     and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Auto-create profile on signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
