-- =============================================================
-- SIPLAP — OPS: update akun "Unit Samapta Polsek Bojong"
-- =============================================================
-- PERUBAHAN YANG DIMINTA
--   Kode login : unit.samapta.bojong → unit.samapta.bojong1
--                (sesuai tampilan di app + angka 1 di belakang)
--   PIN/Password: unit.samapta.bojong1 (sama dengan kode login-nya)
--
-- CATATAN TEKNIS
--   Login pelapor memakai email sintetis <kode_login>@regu.siplap.id,
--   jadi kode dan email akun Auth HARUS diubah berbarengan. Skrip ini
--   mengubah: regu.kode_login, email + password akun Auth, dan
--   menautkan kembali auth_user_id. Data laporan tidak tersentuh.
--
-- CARA PAKAI
--   1. Jalankan apa adanya dulu → PREVIEW (tidak mengubah apa pun).
--   2. Bila preview benar, ubah v_confirm menjadi true lalu jalankan
--      ulang. (PIN juga bisa diganti di v_pin bila suatu saat perlu.)
--   3. Setelah sukses, login di HP: kode unit.samapta.bojong1
--      + PIN unit.samapta.bojong1.
-- =============================================================

-- ============ PREVIEW (aman) ============
select r.id, r.kode_login, r.nama_regu, r.unit_key, r.wilayah_key,
       r.access_level, r.status_aktif, r.auth_user_id,
       (select count(*) from public.laporan l where l.regu_id = r.id) as jml_laporan
from public.regu r
where lower(r.kode_login) like 'unit.samapta.bojong%';

select u.id, u.email, u.email_confirmed_at is not null as terkonfirmasi
from auth.users u
where lower(u.email) in (
  'unit.samapta.bojong@regu.siplap.id',
  'unit.samapta.bojong1@regu.siplap.id'
);

-- ============ EKSEKUSI ============
do $$
declare
  v_confirm boolean := false;  -- ←←← UBAH KE true UNTUK MENJALANKAN

  v_kode_lama  text := 'unit.samapta.bojong';
  v_kode_baru  text := 'unit.samapta.bojong1';
  v_pin        text := 'unit.samapta.bojong1';  -- PIN = kode login baru

  v_email_lama text;
  v_email_baru text;
  v_regu_id    uuid;
  v_auth_id    uuid;
begin
  if not v_confirm then
    raise notice 'MODE PREVIEW — tidak ada yang diubah. Set v_confirm=true untuk eksekusi.';
    return;
  end if;

  v_email_lama := v_kode_lama || '@regu.siplap.id';
  v_email_baru := v_kode_baru || '@regu.siplap.id';

  -- 0) Cari baris regu target (kode lama; bila sudah pernah diganti,
  --    pakai kode baru sebagai fallback).
  select r.id into v_regu_id
  from public.regu r
  where lower(r.kode_login) in (v_kode_lama, v_kode_baru)
  limit 1;

  if v_regu_id is null then
    raise exception 'Akun % tidak ditemukan — cek preview di atas.', v_kode_lama;
  end if;

  -- 1) Update kode login (dan pastikan akun aktif).
  update public.regu
  set kode_login   = v_kode_baru,
      status_aktif = true
  where id = v_regu_id;
  raise notice 'Kode login diubah: % → %', v_kode_lama, v_kode_baru;

  -- 2) Akun Auth: samakan email + reset password = PIN baru.
  select u.id into v_auth_id
  from auth.users u
  where lower(u.email) in (v_email_lama, v_email_baru)
  limit 1;

  if v_auth_id is not null then
    update auth.users
    set email                = v_email_baru,
        encrypted_password   = extensions.crypt(v_pin, extensions.gen_salt('bf', 10)),
        email_confirmed_at   = coalesce(email_confirmed_at, now()),
        updated_at           = now()
    where id = v_auth_id;
    raise notice 'Akun Auth diperbarui: email=% , PIN=kode login baru.', v_email_baru;
  else
    raise notice 'PERHATIAN: tidak ada user Auth untuk %/%. Baris regu sudah diubah, tapi jalankan `npm run provision:jawara` (atau buat manual) agar bisa login.', v_kode_lama, v_kode_baru;
  end if;

  -- 3) Tautkan kembali auth_user_id.
  update public.regu
  set auth_user_id = v_auth_id
  where id = v_regu_id;

  raise notice '==== SELESAI: login dengan kode % + PIN yang sama ====', v_kode_baru;
end $$;

-- ============ VERIFIKASI ============
select kode_login, nama_regu, unit_key, wilayah_key, access_level,
       status_aktif, auth_user_id is not null as auth_tertaut
from public.regu
where kode_login = 'unit.samapta.bojong1';

select u.email, u.email_confirmed_at is not null as terkonfirmasi
from auth.users u
where lower(u.email) = 'unit.samapta.bojong1@regu.siplap.id';
