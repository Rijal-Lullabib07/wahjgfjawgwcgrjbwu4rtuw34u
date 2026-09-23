-- =============================================================
-- SIPLAP — Migration 0025: POSISI mengikuti cakupan pemantau
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- LATAR BELAKANG (BUG):
--   RLS tabel `posisi` sebelumnya:
--     using (true)   ← semua authenticated melihat SEMUA posisi.
--   Akibatnya Kapolsek melihat personel Polsek lain di Peta
--   Kegiatan, dan Kasat melihat personel satuan lain. Cakupan
--   "dibatasi di klien" yang disebut komentar migration 0018
--   tidak pernah diimplementasikan.
--
-- YANG DILAKUKAN migration ini:
--   1) Baca posisi:
--      - pelapor  → hanya barisnya sendiri
--      - pemantau → posisi regu dalam cakupan can_read_monitor_scope()
--        (Kapolsek = wilayahnya, Kasat = unit fungsinya,
--         Kapolres/Wakapolres/Kabag Ops = semua)
--   2) Tulis posisi: tetap hanya pemilik baris (tidak berubah).
--   3) Re-apply fungsi scope dari db_supabase.sql supaya definisi
--      pemantau konsisten (current_monitor_id).
-- =============================================================

-- 0) Pastikan helper ada & versinya konsisten (idempoten) ---------
create or replace function public.current_username()
returns text
language sql stable security definer set search_path = public
as $$ select lower(split_part(coalesce(auth.email(), ''), '@', 1)); $$;

create or replace function public.current_regu_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select r.id from public.regu r
  where lower(coalesce(r.kode_login, '')) = public.current_username();
$$;

create or replace function public.current_monitor_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select a.id from public.admin_users a
  where lower(coalesce(a.username, '')) = public.current_username()
     or lower(a.email) = lower(coalesce(auth.email(), ''))
  limit 1;
$$;

create or replace function public.can_read_monitor_scope(
  target_unit_key text,
  target_wilayah_key text
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.id = public.current_monitor_id()
      and (
        lower(trim(coalesce(a.access_level, ''))) = 'all'
        or (
          lower(trim(a.access_level)) = 'wilayah'
          and lower(trim(coalesce(target_wilayah_key, ''))) =
              lower(trim(coalesce(a.scope_key, '')))
        )
        or (
          lower(trim(a.access_level)) = 'fungsi'
          and lower(trim(coalesce(target_unit_key, ''))) =
              lower(trim(coalesce(a.scope_key, '')))
        )
      )
  );
$$;

-- 1) RLS POSISI: baca sesuai cakupan -----------------------------

drop policy if exists "posisi readable by authenticated" on public.posisi;
drop policy if exists "posisi read scoped" on public.posisi;
create policy "posisi read scoped"
on public.posisi for select to authenticated
using (
  regu_id = public.current_regu_id()
  or exists (
    select 1 from public.regu r
    where r.id = posisi.regu_id
      and public.can_read_monitor_scope(r.unit_key, r.wilayah_key)
  )
);

-- 2) Tulis posisi tetap hanya pemilik ----------------------------

drop policy if exists "posisi insert own" on public.posisi;
create policy "posisi insert own"
on public.posisi for insert to authenticated
with check (regu_id = public.current_regu_id());

drop policy if exists "posisi update own" on public.posisi;
create policy "posisi update own"
on public.posisi for update to authenticated
using (regu_id = public.current_regu_id())
with check (regu_id = public.current_regu_id());

-- 3) VERIFIKASI ---------------------------------------------------
-- Login sebagai kapolsek.jatiluhur lalu jalankan:
--   select count(*) from public.posisi;   -- hanya personel Jatiluhur
-- Login sebagai kapolres.purwakarta:
--   select count(*) from public.posisi;   -- semua personel
