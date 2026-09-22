-- =============================================================
-- SIPLAP — Migration 0017: Perbaikan manajemen personel
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- LATAR BELAKANG:
-- RPC `buat_akun_personel` / `reset_pin_personel` (0016) menulis
-- langsung ke schema `auth`. Di Supabase HOSTED itu diblokir
-- (permission denied for table users / 42501) walaupun fungsinya
-- security definer. Satu-satunya jalur resmi membuat auth user
-- adalah Auth Admin API via service-role key → dipindah ke
-- Edge Function `manage-personel`.
--
-- Yang dilakukan migration ini:
--   1) Tambah kolom regu.auth_user_id (tautan ke auth.users.id)
--   2) DROP kedua RPC yang bermasalah (tidak dipakai lagi)
--   3) (opsional, berkomentar) backfill auth_user_id dari email
-- =============================================================

-- 1) Kolom tautan auth --------------------------------------------

alter table public.regu add column if not exists auth_user_id uuid;

-- 2) Buang RPC lama yang menulis ke schema auth --------------------

drop function if exists public.buat_akun_personel(text, text, text, text, text, text, text);
drop function if exists public.reset_pin_personel(text, text);

-- 3) Backfill auth_user_id (opsional) ------------------------------
-- Jalankan bila ingin menautkan personel lama yang akun auth-nya
-- sudah dibuat oleh script provisioning:
--
-- update public.regu r
--    set auth_user_id = u.id
--   from auth.users u
--  where lower(u.email) = lower(r.kode_login) || '@regu.siplap.id'
--    and r.auth_user_id is null;
