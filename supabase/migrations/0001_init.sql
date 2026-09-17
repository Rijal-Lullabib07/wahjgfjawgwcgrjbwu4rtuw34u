-- =============================================================
-- SIPLAP — Migration 0001: Skema, Index, Storage, RLS, pg_cron
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
-- =============================================================

-- 1) TABEL UTAMA -------------------------------------------------

create table if not exists public.regu (
  id           uuid primary key default gen_random_uuid(),
  nama_regu    text not null,
  kode_login   text not null unique,
  status_aktif boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.admin_users (
  id         uuid primary key default gen_random_uuid(),
  nama       text not null,
  email      text not null unique,
  role       text not null check (role in ('admin','pimpinan')),
  created_at timestamptz not null default now()
);

create table if not exists public.laporan (
  id              uuid primary key default gen_random_uuid(),
  regu_id         uuid not null references public.regu(id) on delete cascade,
  timestamp_kirim timestamptz not null default now(),
  siklus_ke       int  not null check (siklus_ke between 1 and 12),
  latitude        double precision,
  longitude       double precision,
  status_sync     text not null default 'pending' check (status_sync in ('pending','synced','failed')),
  catatan         text,
  created_at      timestamptz not null default now()
);

create table if not exists public.laporan_foto (
  id                  uuid primary key default gen_random_uuid(),
  laporan_id          uuid not null references public.laporan(id) on delete cascade,
  storage_path        text not null,
  watermark_lat       double precision,
  watermark_lng       double precision,
  watermark_timestamp timestamptz not null,
  urutan_foto         int  not null check (urutan_foto in (1,2)),
  created_at          timestamptz not null default now(),
  unique (laporan_id, urutan_foto)
);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  regu_id    uuid references public.regu(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- 2) INDEX -------------------------------------------------------

create index if not exists idx_laporan_regu_id      on public.laporan (regu_id);
create index if not exists idx_laporan_timestamp    on public.laporan (timestamp_kirim desc);
create index if not exists idx_laporan_siklus       on public.laporan (regu_id, siklus_ke, timestamp_kirim desc);
create index if not exists idx_laporan_foto_laporan on public.laporan_foto (laporan_id);
create index if not exists idx_push_sub_regu        on public.push_subscriptions (regu_id);

-- 3) STORAGE BUCKET ----------------------------------------------

insert into storage.buckets (id, name, public) values ('laporan-foto','laporan-foto', true)
on conflict (id) do nothing;

-- Hapus policy lama bila sudah ada (agar definisi terbaru selalu terpasang)
drop policy if exists "regu upload own folder" on storage.objects;
drop policy if exists "public read foto" on storage.objects;

-- Regu boleh upload ke folder miliknya (path: <regu_id>/...)
create policy "regu upload own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'laporan-foto'
  and (storage.foldername(name))[1]::uuid in (select id from public.regu)
);

create policy "public read foto"
on storage.objects for select to anon, authenticated
using (bucket_id = 'laporan-foto');

-- 4) HELPER: role user saat ini ----------------------------------

create or replace function public.current_regu_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select r.id from public.regu r
  where r.kode_login = upper(split_part(coalesce(auth.email(), ''), '@', 1));
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a where a.email = auth.email()
  );
$$;

-- 5) RLS ---------------------------------------------------------

alter table public.regu                enable row level security;
alter table public.admin_users         enable row level security;
alter table public.laporan             enable row level security;
alter table public.laporan_foto        enable row level security;
alter table public.push_subscriptions  enable row level security;

-- Hapus policy lama bila sudah ada (agar aman dijalankan ulang)
drop policy if exists "regu readable by authenticated" on public.regu;
drop policy if exists "admin_users readable by admin"  on public.admin_users;
drop policy if exists "regu select own laporan"        on public.laporan;
drop policy if exists "regu insert own laporan"        on public.laporan;
drop policy if exists "admin update laporan"           on public.laporan;
drop policy if exists "foto select via laporan"        on public.laporan_foto;
drop policy if exists "foto insert via laporan"        on public.laporan_foto;
drop policy if exists "push sub manage own"            on public.push_subscriptions;
drop policy if exists "push sub admin read"            on public.push_subscriptions;

-- regu: semua pengguna terautentikasi bisa melihat daftar regu
create policy "regu readable by authenticated"
on public.regu for select to authenticated using (true);

-- admin_users hanya bisa dibaca admin
create policy "admin_users readable by admin"
on public.admin_users for select to authenticated using (public.is_admin());

-- laporan: regu hanya lihat/insert miliknya; admin lihat semua
create policy "regu select own laporan"
on public.laporan for select to authenticated
using (regu_id = public.current_regu_id() or public.is_admin());

create policy "regu insert own laporan"
on public.laporan for insert to authenticated
with check (regu_id = public.current_regu_id());

-- admin boleh update status_sync (mis. tandai failed/synced)
create policy "admin update laporan"
on public.laporan for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- laporan_foto mengikuti laporan induk
create policy "foto select via laporan"
on public.laporan_foto for select to authenticated
using (
  exists (
    select 1 from public.laporan l
    where l.id = laporan_id and (l.regu_id = public.current_regu_id() or public.is_admin())
  )
);

create policy "foto insert via laporan"
on public.laporan_foto for insert to authenticated
with check (
  exists (
    select 1 from public.laporan l
    where l.id = laporan_id and l.regu_id = public.current_regu_id()
  )
);

-- push_subscriptions: regu kelola device miliknya; admin baca semua
create policy "push sub manage own"
on public.push_subscriptions for all to authenticated
using (regu_id = public.current_regu_id() or regu_id is null)
with check (regu_id = public.current_regu_id() or regu_id is null);

create policy "push sub admin read"
on public.push_subscriptions for select to authenticated
using (public.is_admin());

-- 6) REALTIME (idempoten) ----------------------------------------
-- Hanya pakai publication 'supabase_realtime' bawaan Supabase.
-- Publication 'supabase_full_user_data' tidak ada di semua project,
-- sehingga tidak digunakan (sebelumnya penyebab error 42704).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'laporan'
    ) then
      execute 'alter publication supabase_realtime add table public.laporan';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'laporan_foto'
    ) then
      execute 'alter publication supabase_realtime add table public.laporan_foto';
    end if;
  end if;
end $$;

-- 7) PG_CRON: reminder tiap 5 menit ------------------------------
-- Ekstensi: aktifkan dulu di Dashboard → Database → Extensions (pg_cron & pg_net).
-- GANTI <PROJECT_REF> dan <SERVICE_ROLE_KEY> sebelum menjalankan blok ini.

-- create extension if not exists pg_cron;

-- select cron.unschedule('siplap-reminder') where exists (
--   select 1 from cron.job where jobname = 'siplap-reminder'
-- );

-- select cron.schedule(
--   'siplap-reminder',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/reminder-push',
--     headers := jsonb_build_object(
--       'Content-Type','application/json',
--       'Authorization','Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
