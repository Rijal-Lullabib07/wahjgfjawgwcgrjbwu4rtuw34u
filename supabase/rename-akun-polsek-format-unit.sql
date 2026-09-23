-- =============================================================
-- SIPLAP — OPS: RENAME AKUN PELAPOR POLSEK KE FORMAT unit.<unit>.<polsek>
-- =============================================================
-- PERUBAHAN YANG DIMINTA
--   Kode login  : <unit>.<polsek>  →  unit.<unit>.<polsek>
--                 contoh: spkt.jatiluhur → unit.spkt.jatiluhur
--                         intelkam.kota  → unit.intelkam.kota
--   Nama tampil : "Intelkam Polsek Jatiluhur" → "Polsek Jatiluhur Unit Intelkam"
--   Email Auth  : <kode_lama>@regu.siplap.id → <kode_baru>@regu.siplap.id
--   PIN/Password: TIDAK diubah secara default (orang lapangan tidak perlu
--                 ganti PIN). Bila ingin PIN disamakan dengan kode baru,
--                 ubah v_reset_pin menjadi true di bagian eksekusi.
--
-- CATATAN TEKNIS
--   - unit_key & wilayah_key TIDAK berubah, jadi folder, RLS (Kapolsek
--     hanya melihat Polseknya, Kasat hanya fungsinya, Kapolres/Wakapolres/
--     Kabag Ops melihat semua), dan grafik dashboard tetap benar.
--   - Laporan lama tidak tersentuh (regu_id tidak berubah).
--   - Skrip idempoten: bila sudah pernah dijalankan, tinggal memperbaiki
--     nama tampil baris yang sudah berformat unit.*
--
-- CARA PAKAI
--   1. Jalankan apa adanya → PREVIEW (tidak mengubah apa pun).
--   2. Cek daftar di langkah 1: 84 baris format lama (atau 0 bila sudah
--      pernah direname). Bila muncul baris aneh di "3) LAIN-LAIN",
--      tangani dulu secara manual.
--   3. Ubah v_confirm menjadi true lalu jalankan ulang seluruh file.
--   4. Verifikasi di bagian akhir: total level-1 harus 84 dan SEMUA
--      berformat unit.*
-- =============================================================

-- ============ 1) PREVIEW (aman) ============

-- 1a) Baris format lama yang akan direname
select r.kode_login, r.nama_regu, r.unit_key, r.wilayah_key,
       'unit.' || r.unit_key || '.' || r.wilayah_key as kode_baru,
       'Polsek ' || coalesce(w.nama, r.wilayah_key) || ' Unit ' ||
         coalesce(u.nama, r.unit_key) as nama_baru
from public.regu r
left join (values
  ('kota','Purwakarta Kota'), ('plered','Plered'),
  ('jatiluhur','Jatiluhur'),  ('bungursari','Bungursari'),
  ('campaka','Campaka'),      ('cibatu','Cibatu'),
  ('pasawahan','Pasawahan'),  ('darangdan','Darangdan'),
  ('wanayasa','Wanayasa'),    ('maniis','Maniis'),
  ('sukatani','Sukatani'),    ('sukasari','Sukasari'),
  ('kiarapedes','Kiarapedes'),('bojong','Bojong')
) as w(wilayah_key, nama) on w.wilayah_key = r.wilayah_key
left join (values
  ('spkt','SPKT'), ('intelkam','Intelkam'), ('reskrim','Reskrim'),
  ('binmas','Binmas'), ('samapta','Samapta'), ('lantas','Lantas')
) as u(unit_key, nama) on u.unit_key = r.unit_key
where r.access_level = 'pelapor-level-1'
  and r.kode_login ~* '^(spkt|intelkam|reskrim|binmas|samapta|lantas)\.(kota|plered|jatiluhur|bungursari|campaka|cibatu|pasawahan|darangdan|wanayasa|maniis|sukatani|sukasari|kiarapedes|bojong)$'
order by r.wilayah_key, r.unit_key;

-- 1b) Baris yang SUDAH berformat unit.* (nama lama ikut diperbaiki bila beda)
select r.kode_login, r.nama_regu, r.unit_key, r.wilayah_key
from public.regu r
where r.access_level = 'pelapor-level-1'
  and r.kode_login ~* '^unit\.(spkt|intelkam|reskrim|binmas|samapta|lantas)\.(kota|plered|jatiluhur|bungursari|campaka|cibatu|pasawahan|darangdan|wanayasa|maniis|sukatani|sukasari|kiarapedes|bojong)$'
order by r.wilayah_key, r.unit_key;

-- 1c) LAIN-LAIN: level-1 di luar dua pola di atas (harus kosong).
--     Bila ada (mis. sisa akun manual "unit.samapta.bojong1" atau
--     "unit.intelkam.polsek.jatiluhur"), tangani manual dulu.
select r.kode_login, r.nama_regu, r.unit_key, r.wilayah_key,
       (select count(*) from public.laporan l where l.regu_id = r.id) as jml_laporan
from public.regu r
where r.access_level = 'pelapor-level-1'
  and r.kode_login !~* '^(unit\.)?(spkt|intelkam|reskrim|binmas|samapta|lantas)\.(kota|plered|jatiluhur|bungursari|campaka|cibatu|pasawahan|darangdan|wanayasa|maniis|sukatani|sukasari|kiarapedes|bojong)$'
order by r.kode_login;

-- ============ 2) EKSEKUSI ============
do $$
declare
  v_confirm   boolean := false;  -- ←←← UBAH KE true UNTUK MENJALANKAN
  v_reset_pin boolean := false;  -- true = PIN di-reset sama dengan kode login baru

  v_units    text[] := array['spkt','intelkam','reskrim','binmas','samapta','lantas'];
  v_labels   text[] := array['SPKT','Intelkam','Reskrim','Binmas','Samapta','Lantas'];
  v_unit     text;
  v_label    text;
  v_i        int;

  v_wilayah  record;
  v_nama_w   text;
  v_kode_lama text;
  v_kode_baru text;
  v_email_lama text;
  v_email_baru text;
  v_nama_baru  text;
  v_regu_id    uuid;
  v_n_rename   int := 0;
  v_n_nama     int := 0;
  v_n_auth     int := 0;
begin
  if not v_confirm then
    raise notice 'MODE PREVIEW — tidak ada yang diubah. Set v_confirm=true untuk eksekusi.';
    return;
  end if;

  for v_wilayah in
    select * from (values
      ('kota','Purwakarta Kota'), ('plered','Plered'),
      ('jatiluhur','Jatiluhur'),  ('bungursari','Bungursari'),
      ('campaka','Campaka'),      ('cibatu','Cibatu'),
      ('pasawahan','Pasawahan'),  ('darangdan','Darangdan'),
      ('wanayasa','Wanayasa'),    ('maniis','Maniis'),
      ('sukatani','Sukatani'),    ('sukasari','Sukasari'),
      ('kiarapedes','Kiarapedes'),('bojong','Bojong')
    ) as t(wilayah_key, nama)
  loop
    v_nama_w := v_wilayah.nama;

    for v_i in 1..6
    loop
      v_unit  := v_units[v_i];
      v_label := v_labels[v_i];
      v_kode_baru  := 'unit.' || v_unit || '.' || v_wilayah.wilayah_key;
      v_email_baru := v_kode_baru || '@regu.siplap.id';
      v_nama_baru  := 'Polsek ' || v_nama_w || ' Unit ' || v_label;

      -- Baris target: kode lama TANPA prefix, ATAU kode baru (idempoten).
      select r.id, r.kode_login into v_regu_id, v_kode_lama
      from public.regu r
      where r.access_level = 'pelapor-level-1'
        and r.unit_key = v_unit
        and r.wilayah_key = v_wilayah.wilayah_key
        and r.kode_login in (v_unit || '.' || v_wilayah.wilayah_key, v_kode_baru)
      limit 1;

      if v_regu_id is null then
        raise warning 'TIDAK KETEMU: unit % wilayah % (dilewati)', v_unit, v_wilayah.wilayah_key;
        continue;
      end if;

      -- Cegah tabrakan bila kebetulan sudah ada baris lain dengan kode baru.
      if v_kode_lama <> v_kode_baru then
        if exists (
          select 1 from public.regu x
          where x.kode_login = v_kode_baru and x.id <> v_regu_id
        ) then
          raise exception 'Kode % sudah dipakai baris lain — selesaikan manual.', v_kode_baru;
        end if;
      end if;

      -- 1) Regu: kode + nama (nama dipaksa sinkron walau kode sudah benar).
      update public.regu
      set kode_login = v_kode_baru,
          nama_regu  = v_nama_baru,
          status_aktif = true
      where id = v_regu_id;
      if v_kode_lama <> v_kode_baru then
        v_n_rename := v_n_rename + 1;
      else
        v_n_nama := v_n_nama + 1;
      end if;

      -- 2) Auth: samakan email; PIN opsional di-reset = kode baru.
      v_email_lama := v_kode_lama || '@regu.siplap.id';
      if lower(v_email_lama) <> lower(v_email_baru) then
        if v_reset_pin then
          update auth.users
          set email      = v_email_baru,
              email_confirmed_at = coalesce(email_confirmed_at, now()),
              encrypted_password = extensions.crypt(v_kode_baru, extensions.gen_salt('bf', 10)),
              updated_at = now()
          where lower(email) = lower(v_email_lama);
        else
          update auth.users
          set email      = v_email_baru,
              email_confirmed_at = coalesce(email_confirmed_at, now()),
              updated_at = now()
          where lower(email) = lower(v_email_lama);
        end if;
        get diagnostics v_n_auth = row_count;
        if v_n_auth = 0 then
          raise warning 'Auth user tidak ketemu untuk % (regu tetap diubah).', v_kode_lama;
        end if;
      end if;

      v_regu_id := null;
    end loop;
  end loop;

  raise notice '==== SELESAI: % kode direname, % nama diperbaiki ====', v_n_rename, v_n_nama;
  raise notice 'PIN tidak diubah (v_reset_pin=false). Bila ingin PIN = kode baru, set v_reset_pin=true lalu jalankan ulang.';
end $$;

-- ============ 3) VERIFIKASI ============
-- Harus 84; SEMUA harus berawalan unit.
select count(*) as total_level1,
       count(*) filter (where kode_login like 'unit.%') as format_baru,
       count(*) filter (where kode_login not like 'unit.%') as format_lama
from public.regu
where access_level = 'pelapor-level-1';

-- Nama tampil harus "Polsek <Nama> Unit <Unit>"
select kode_login, nama_regu from public.regu
where access_level = 'pelapor-level-1'
order by wilayah_key, unit_key
limit 12;

-- Email Auth harus mengikuti kode baru
select u.email, u.email_confirmed_at is not null as terkonfirmasi
from auth.users u
where u.email like '%@regu.siplap.id'
  and u.email !~* '^unit\.(spkt|intelkam|reskrim|binmas|samapta|lantas)\.'
order by u.email;
