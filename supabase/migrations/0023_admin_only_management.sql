-- =============================================================
-- SIPLAP — Migration 0023: Kelola personel hanya untuk ADMIN
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- LATAR BELAKANG:
-- Wakapolres punya access_level 'all' tetapi role 'pimpinan'
-- (read-only). Penjaga sebelumnya hanya mengecek access_level,
-- jadi Wakapolres bisa ikut mengelola personel/pemantau.
--
-- Yang dilakukan migration ini:
--   1) Fungsi helper public.is_admin_penuh() — true HANYA bila
--      pemanggil role 'admin' DAN access_level 'all'.
--   2) RLS policy kelola (insert/update/delete) di regu,
--      admin_users, dan jenis_laporan diganti ke is_admin_penuh().
--   3) Baca (select) tetap seperti semula — pimpinan tetap bisa
--      melihat daftar personel & pemantau.
-- =============================================================

-- 1) HELPER: ADMIN PENUH (role admin + access_level all) ---------
create or replace function public.is_admin_penuh()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where (
      lower(a.email) = lower(coalesce(auth.email(), ''))
      or lower(coalesce(a.username, '')) = public.current_username()
    )
      and a.role = 'admin'
      and a.access_level = 'all'
  );
$$;

revoke all on function public.is_admin_penuh() from public, anon;
grant execute on function public.is_admin_penuh() to authenticated;

-- 2) REGU: tambah & ubah hanya admin penuh ----------------------
-- (select tetap terbuka untuk semua authenticated)

drop policy if exists "admin manages regu" on public.regu;
create policy "admin manages regu"
on public.regu for insert to authenticated
with check (public.is_admin_penuh());

drop policy if exists "admin updates regu" on public.regu;
create policy "admin updates regu"
on public.regu for update to authenticated
using (public.is_admin_penuh()) with check (public.is_admin_penuh());

-- 3) ADMIN_USERS: ubah hanya admin penuh ------------------------

drop policy if exists "admin manages admin_users" on public.admin_users;
create policy "admin manages admin_users"
on public.admin_users for update to authenticated
using (public.is_admin_penuh()) with check (public.is_admin_penuh());

-- 4) JENIS_LAPORAN: tambah & ubah hanya admin penuh -------------

drop policy if exists "jenis admin insert" on public.jenis_laporan;
create policy "jenis admin insert"
on public.jenis_laporan for insert to authenticated
with check (public.is_admin_penuh());

drop policy if exists "jenis admin update" on public.jenis_laporan;
create policy "jenis admin update"
on public.jenis_laporan for update to authenticated
using (public.is_admin_penuh()) with check (public.is_admin_penuh());

-- 5) KOREKSI DATA: Wakapolres adalah PIMPINAN (read-only) --------
-- Dicari dengan POLA (bukan username pasti) karena username/email
-- bisa berubah lewat menu Edit; berlaku untuk semua varian akun
-- Wakapolres. Pengaman: admin utama tidak pernah ikut turun.
update public.admin_users
   set role = 'pimpinan'
 where (
     lower(coalesce(username, '')) like '%wakapolres%'
  or lower(coalesce(email, '')) like '%wakapolres%'
  or lower(nama) = 'wakapolres'
 )
 and lower(coalesce(email, '')) not in ('admin@polres.go.id')
 and lower(coalesce(username, '')) not in ('polres.kapolres', 'polres.admin');
