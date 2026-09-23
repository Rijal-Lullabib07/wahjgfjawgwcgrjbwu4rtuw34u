-- =============================================================
-- SIPLAP — Migration 0026: TUTUP KEBOCORAN DAFTAR REGU + is_admin()
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- LATAR BELAKANG (BUG 1 — kebocoran daftar regu):
--   Migration 0006 membuat policy SELECT di tabel `regu`:
--     "accounts readable by authenticated" ... using (true)
--   Migration 0010 & 0012 hanya menimpa policy bernama
--   "accounts readable by own scope" — policy terbuka warisan
--   0006 TIDAK pernah di-drop. RLS permissive = OR, jadi yang
--   menang tetap using (true): SEMUA pemantau bisa membaca
--   seluruh daftar 107 regu (dropdown "Semua Unit", filter PDF/
--   Excel menampilkan unit se-Kab. Purwakarta).
--
--   (BUG 2 — is_admin() salah):
--   Versi 0006 mengecek "ada user pemantau" DAN "ada user dengan
--   access_level all" pada DUA baris berbeda → setiap pemantau
--   (termasuk Kapolsek & Kasat) dianggap admin: bisa UPDATE
--   laporan & menerima akses kelola yang seharusnya bukan haknya.
--
-- YANG DILAKUKAN:
--   1) Drop SEMUA policy SELECT lama di regu, pasang SATU policy
--      cakupan: profil sendiri (pelapor) ATAU regu dalam cakupan
--      can_read_monitor_scope() (Kapolsek = wilayahnya, Kasat =
--      unit fungsinya, all = semua).
--   2) is_admin(): access_level 'all' WAJIB pada baris pemanggil
--      itu sendiri.
--   3) Verifikasi disertakan di bagian bawah.
-- =============================================================

-- 1) TABEL REGU: satu policy SELECT cakupan ----------------------
drop policy if exists "regu readable by authenticated" on public.regu;
drop policy if exists "accounts readable by authenticated" on public.regu;
drop policy if exists "accounts readable by own scope" on public.regu;
create policy "accounts readable by own scope"
on public.regu for select to authenticated
using (
  id = public.current_regu_id()
  or public.can_read_monitor_scope(unit_key, wilayah_key)
);

-- 2) is_admin(): baris pemanggil WAJIB access_level 'all' --------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where a.id = public.current_monitor_id()
      and lower(trim(coalesce(a.access_level, ''))) = 'all'
  );
$$;

-- 3) is_monitor() ikut dipertegas lewat current_monitor_id -------
create or replace function public.is_monitor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_monitor_id() is not null;
$$;

-- 4) Helper kelola personel (0023) — pastikan konsisten ----------
create or replace function public.is_admin_penuh()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where a.id = public.current_monitor_id()
      and a.role = 'admin'
      and lower(trim(coalesce(a.access_level, ''))) = 'all'
  );
$$;

-- 5) VERIFIKASI ---------------------------------------------------
-- a) Pastikan TIDAK ada lagi policy SELECT terbuka di regu:
--    (harus 0 baris)
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.regu'::regclass and polcmd = 'r';

-- b) Cek kebijakan aktif di tabel regu:
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'regu';

-- UJI DENGAN LOGIN:
--   kapolsek.jatiluhur → select count(*) from public.regu;  -- 6 (unit Jatiluhur saja)
--   sat.reskrim        → select count(*) from public.regu;  -- Satreskrim(5) + reskrim di 14 Polsek = 19
--   kapolres.purwakarta→ select count(*) from public.regu;  -- 107 (semua)
