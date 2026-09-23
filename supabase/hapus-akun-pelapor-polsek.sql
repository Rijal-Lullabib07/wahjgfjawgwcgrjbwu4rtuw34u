-- =============================================================
-- SIPLAP — OPS: hapus akun pelapor yang mengandung kata "pelapor"
-- =============================================================
-- TUJUAN
-- Hapus PERMANEN akun pelapor tingkat Polsek yang ada unsur "pelapor"
-- pada kode login ATAU nama regu (mis. spkt.pelapor01 … spkt.pelapor14,
-- "SPKT Pelapor 01", pelapor01, dst.) BESERTA SELURUH DATANYA:
-- laporan, foto, video (baris + file di Storage), posisi realtime,
-- dan subscription push.
--
-- YANG DIPERTAHANKAN (acuan file JAWARA):
--   spkt.<polsek>, intelkam.<polsek>, reskrim.<polsek>,
--   binmas.<polsek>, samapta.<polsek>, lantas.<polsek>
--   polsek = kota, plered, jatiluhur, bungursari, campaka, cibatu,
--            pasawahan, darangdan, wanayasa, maniis, sukatani,
--            sukasari, kiarapedes, bojong
-- Catatan: jumlah per unit TIDAK seragam sesuai presensi JAWARA:
--   lantas hanya 5 polsek (kota, plered, jatiluhur, bungursari, cibatu),
--   samapta 13 (tidak ada di sukatani), binmas 11 (tidak ada di
--   plered/darangdan/sukasari), spkt/intelkam/reskrim 14 semua.
-- Akun tingkat Polres (*.polres / pelapor-level-2) TIDAK disentuh.
--
-- CARA PAKAI
--   1. Tempel seluruh isi file ini di Supabase SQL Editor.
--   2. Jalankan SEBAGAIMANA ADANYA (v_confirm masih false) → mode
--      preview: hanya menampilkan daftar & jumlah yang AKAN dihapus.
--   3. Bila daftarnya sudah benar, cari dua baris "-- v_confirm"
--      di bawah dan ubah nilainya menjadi true, lalu jalankan ulang.
--   4. Blok "opsional" penghapusan akun auth boleh dinonaktifkan
--      (jadi komentar) bila akun Auth ingin dibiarkan.
--
-- PERINGATAN: eksekusi dengan v_confirm = true TIDAK BISA dibatalkan.
-- =============================================================

-- ============ 1) PREVIEW (aman, tidak menghapus apa pun) ============
do $$
declare
  v_confirm boolean := false;  -- preview: jangan diubah
  v_n_regu  int;
  v_n_lap   int;
  v_n_foto  int;
  v_n_video int;
begin
  if v_confirm then
    raise notice 'DIBATALKAN: blok preview seharusnya tidak dipakai untuk eksekusi.';
    return;
  end if;

  create temp table target_regu on commit drop as
    select r.id, r.kode_login, r.nama_regu,
           lower(r.kode_login) || '@regu.siplap.id' as email
    from public.regu r
    where (lower(r.kode_login) like '%pelapor%'
           or lower(r.nama_regu) like '%pelapor%')
      and coalesce(r.access_level, '') <> 'pelapor-level-2'
      and r.kode_login not like '%.polres';

  select count(*) into v_n_regu from target_regu;
  select count(*) into v_n_lap
    from public.laporan l join target_regu t on t.id = l.regu_id;
  select count(*) into v_n_foto
    from public.laporan_foto f
    join public.laporan l on l.id = f.laporan_id
    join target_regu t on t.id = l.regu_id;
  select count(*) into v_n_video
    from public.laporan_video v
    join public.laporan l on l.id = v.laporan_id
    join target_regu t on t.id = l.regu_id;

  raise notice '==== PREVIEW: yang AKAN dihapus ====';
  raise notice 'Akun regu : %', v_n_regu;
  raise notice 'Laporan   : %', v_n_lap;
  raise notice 'Foto      : %', v_n_foto;
  raise notice 'Video     : %', v_n_video;
end $$;

-- Daftar lengkap akun target (periksa satu per satu).
select r.kode_login, r.nama_regu, r.access_level,
       (select count(*) from public.laporan l where l.regu_id = r.id) as jml_laporan
from public.regu r
where (lower(r.kode_login) like '%pelapor%'
       or lower(r.nama_regu) like '%pelapor%')
  and coalesce(r.access_level, '') <> 'pelapor-level-2'
  and r.kode_login not like '%.polres'
order by r.kode_login;

-- Akun yang DIPERTAHANKAN beserta jumlah laporannya (tidak boleh ikut
-- terhapus oleh pola "pelapor" — lihat daftar ini sebagai pembanding).
select r.kode_login, r.nama_regu,
       (select count(*) from public.laporan l where l.regu_id = r.id) as jml_laporan
from public.regu r
where (lower(r.kode_login) like '%pelapor%'
       or lower(r.nama_regu) like '%pelapor%')
  and (coalesce(r.access_level, '') = 'pelapor-level-2'
       or r.kode_login like '%.polres')
order by r.kode_login;

-- ============ 2) EKSEKUSI (hapus PERMANEN) ==========================
-- Jalankan blok ini HANYA setelah preview di atas sudah sesuai harapan:
-- ubah v_confirm di bawah menjadi true, lalu jalankan ulang file ini.
do $$
declare
  v_confirm boolean := false;  -- ←←← UBAH KE true UNTUK MENGHAPUS
  v_n int;
begin
  if not v_confirm then
    raise notice 'DIBATALKAN: v_confirm masih false (mode aman). Tidak ada yang dihapus.';
    return;
  end if;

  create temp table target_regu on commit drop as
    select r.id, r.kode_login,
           lower(r.kode_login) || '@regu.siplap.id' as email
    from public.regu r
    where (lower(r.kode_login) like '%pelapor%'
           or lower(r.nama_regu) like '%pelapor%')
      and coalesce(r.access_level, '') <> 'pelapor-level-2'
      and r.kode_login not like '%.polres';

  -- 1) Hapus file foto/video dari Storage (sebelum baris DB hilang,
  --    agar path-nya masih bisa dihitung dari regu_id).
  delete from storage.objects
  where bucket_id = 'laporan-foto'
    and (storage.foldername(name))[1]::uuid in (select id from target_regu);

  -- 2) Hapus akun regu. laporan, laporan_foto, laporan_video, posisi,
  --    push_subscriptions ikut terhapus otomatis (FK on delete cascade).
  delete from public.regu r
  where r.id in (select id from target_regu);
  get diagnostics v_n = row_count;
  raise notice 'Regu dihapus     : %', v_n;

  -- 3) (OPSIONAL) Hapus akun Auth supaya email & kredensialnya hilang.
  --    Bila dinonaktifkan, login tetap GAGAL karena baris regu sudah
  --    tidak ada, tapi emailnya masih tampil di daftar users Auth.
  delete from auth.users
  where lower(email) in (select email from target_regu);
  get diagnostics v_n = row_count;
  raise notice 'Akun auth dihapus: %', v_n;

  raise notice '==== SELESAI ====';

  -- Verifikasi: sisa akun per unit yang dipertahankan.
  raise notice 'Sisa akun yang DIPERTAHANKAN per unit:';
  for v_n in
    select count(*) from public.regu
    where access_level = 'pelapor-level-1'
      and unit_key in ('spkt','intelkam','reskrim','binmas','samapta','lantas')
  loop
    raise notice 'Total pelapor level-1 6 unit : %', v_n;
  end loop;
end $$;

-- ============ 3) VERIFIKASI SETELAH EKSEKUSI ========================
-- Jumlah akun tersisa per unit (harus sesuai presensi JAWARA:
-- spkt 14, intelkam 14, reskrim 14, samapta 13, binmas 11, lantas 5).
select r.unit_key, count(*) as sisa_akun
from public.regu r
where r.access_level = 'pelapor-level-1'
  and r.unit_key in ('spkt','intelkam','reskrim','binmas','samapta','lantas')
group by r.unit_key
order by r.unit_key;

-- Sisa akun yang mengandung kata "pelapor" — seharusnya kosong untuk
-- tingkat Polsek; sisa (bila ada) hanya akun tingkat Polres.
select r.kode_login, r.nama_regu, r.access_level
from public.regu r
where lower(r.kode_login) like '%pelapor%'
   or lower(r.nama_regu) like '%pelapor%';
