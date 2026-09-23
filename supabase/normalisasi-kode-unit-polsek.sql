-- =============================================================
-- SIPLAP — OPS: NORMALISASI KODE AKUN UNIT POLSEK (yang terdaftar)
-- =============================================================
-- Target akhir (sesuai struktur v2): SEMUA akun pelapor level-1
--   kode login  : unit.<unit>.<wilayah>   contoh: unit.spkt.jatiluhur
--   nama tampil : Polsek <Nama> Unit <Unit>   contoh: Polsek Jatiluhur Unit SPKT
--   email Auth  : <kode>@regu.siplap.id
--
-- BERBEDA dari skrip rename sebelumnya: skrip ini TIDAK bergantung pada
-- pola teks kode lama. Ia membaca kolom unit_key + wilayah_key tiap
-- baris yang terdaftar, lalu menyamakan kodenya — jadi semua varian
-- tertangani:
--     spkt.jatiluhur                → unit.spkt.jatiluhur
--     unit.intelkam.polsek.jatiluhur → unit.intelkam.jatiluhur
--     unit.samapta.bojong1           → digabung ke unit.samapta.bojong
--     unit.spkt.jatiluhur (sudah benar) → nama diperbaiki bila beda
--
-- Duplikat (2+ baris dengan unit_key & wilayah_key sama) DIGABUNG:
--   keeper = baris berkode kanonik / laporan terbanyak; laporan,
--   push subscription, dan posisi dipindah ke keeper; baris duplikat
--   + user Auth-nya dihapus. Laporan tidak hilang.
--
-- PIN/Password TIDAK diubah (v_reset_pin=false). Laporan aman.
--
-- CARA PAKAI
--   1) Jalankan apa adanya → PREVIEW (tidak mengubah apa pun).
--   2) Periksa hasil query 1a–1c di bawah.
--   3) Ubah v_confirm (cari penanda "←←←") menjadi true, jalankan ulang.
--   4) Bila ada warning "Belum ada auth user", jalankan
--      npm run provision:siplap-v2 (password lama dipertahankan).
-- =============================================================

-- ============ 1) PREVIEW (aman) ============

-- 1a) Semua akun level-1 terdaftar + target normalisasinya
select r.kode_login,
       r.unit_key, r.wilayah_key,
       'unit.' || r.unit_key || '.' || r.wilayah_key           as kode_target,
       'Polsek ' || coalesce(w.nama, initcap(r.wilayah_key)) ||
         ' Unit ' || coalesce(u.nama, initcap(r.unit_key))     as nama_target,
       (select count(*) from public.laporan l where l.regu_id = r.id) as jml_laporan,
       r.auth_user_id is not null as auth_tertaut
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
order by r.wilayah_key, r.unit_key;

-- 1b) DUPLIKAT: unit+polsek yang punya lebih dari 1 baris (akan digabung)
select r.unit_key, r.wilayah_key, count(*) as jml_baris,
       string_agg(r.kode_login || ' (laporan: ' ||
         (select count(*) from public.laporan l where l.regu_id = r.id) || ')', ' | '
         order by r.kode_login) as daftar
from public.regu r
where r.access_level = 'pelapor-level-1'
  and r.unit_key is not null and r.wilayah_key is not null
group by r.unit_key, r.wilayah_key
having count(*) > 1;

-- 1c) TIDAK BISA dinormalisasi otomatis (unit/wilayah kosong) — tangani manual
select r.kode_login, r.nama_regu, r.unit_key, r.wilayah_key,
       (select count(*) from public.laporan l where l.regu_id = r.id) as jml_laporan
from public.regu r
where r.access_level = 'pelapor-level-1'
  and (r.unit_key is null or r.wilayah_key is null);

-- ============ 2) EKSEKUSI ============
do $$
declare
  v_confirm   boolean := false;  -- ←←← UBAH KE true UNTUK MENJALANKAN
  v_reset_pin boolean := false;  -- true = PIN di-reset = kode login baru

  v_dup        record;
  v_row        record;
  v_keeper     uuid;
  v_target     text;
  v_nama_baru  text;
  v_email_baru text;
  v_email_lama text;
  v_auth_id    uuid;
  v_other_auth uuid;
  v_n_merge    int := 0;
  v_n_rename   int := 0;
  v_n_nama     int := 0;
begin
  if not v_confirm then
    raise notice 'MODE PREVIEW — tidak ada yang diubah. Set v_confirm=true untuk eksekusi.';
    return;
  end if;

  -- ---------- A) GABUNGKAN DUPLIKAT per (unit_key, wilayah_key) ----------
  for v_row in
    select r.unit_key, r.wilayah_key
    from public.regu r
    where r.access_level = 'pelapor-level-1'
      and r.unit_key is not null and r.wilayah_key is not null
    group by r.unit_key, r.wilayah_key
    having count(*) > 1
  loop
    v_target := 'unit.' || v_row.unit_key || '.' || v_row.wilayah_key;

    -- Keeper: kode sudah kanonik > laporan terbanyak > id terkecil.
    select r.id into v_keeper
    from public.regu r
    where r.access_level = 'pelapor-level-1'
      and r.unit_key = v_row.unit_key and r.wilayah_key = v_row.wilayah_key
    order by (r.kode_login = v_target) desc,
             (select count(*) from public.laporan l where l.regu_id = r.id) desc,
             r.id
    limit 1;

    for v_dup in
      select r.id, r.kode_login, r.auth_user_id, r.jabatan
      from public.regu r
      where r.access_level = 'pelapor-level-1'
        and r.unit_key = v_row.unit_key and r.wilayah_key = v_row.wilayah_key
        and r.id <> v_keeper
    loop
      -- Laporan pindah ke keeper (foto/video ikut via laporan).
      update public.laporan set regu_id = v_keeper where regu_id = v_dup.id;
      -- Push subscription pindah.
      update public.push_subscriptions set regu_id = v_keeper where regu_id = v_dup.id;
      -- Posisi: PK = regu_id → pindahkan bila keeper belum punya, lalu hapus.
      insert into public.posisi (regu_id, latitude, longitude, accuracy_m,
                                 kecepatan_mps, diupdate_pada, created_at)
      select v_keeper, latitude, longitude, accuracy_m,
             kecepatan_mps, diupdate_pada, created_at
      from public.posisi where regu_id = v_dup.id
      on conflict (regu_id) do nothing;
      delete from public.posisi where regu_id = v_dup.id;
      -- Jabatan keeper diisi bila kosong.
      if v_dup.jabatan is not null then
        update public.regu set jabatan = coalesce(jabatan, v_dup.jabatan)
        where id = v_keeper and jabatan is null;
      end if;
      -- User Auth milik duplikat dihapus.
      if v_dup.auth_user_id is not null then
        delete from auth.users where id = v_dup.auth_user_id;
      end if;
      delete from public.regu where id = v_dup.id;
      v_n_merge := v_n_merge + 1;
      raise notice 'GABUNG: % → keeper %', v_dup.kode_login, v_target;
    end loop;
  end loop;

  -- ---------- B) NORMALISASI kode + nama + email Auth ----------
  for v_row in
    select r.id, r.kode_login, r.unit_key, r.wilayah_key, r.auth_user_id,
           coalesce(w.nama, initcap(r.wilayah_key)) as nama_w,
           coalesce(u.nama, initcap(r.unit_key))    as nama_u
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
      and r.unit_key is not null and r.wilayah_key is not null
  loop
    v_target     := 'unit.' || v_row.unit_key || '.' || v_row.wilayah_key;
    v_nama_baru  := 'Polsek ' || v_row.nama_w || ' Unit ' || v_row.nama_u;
    v_email_baru := v_target || '@regu.siplap.id';
    v_email_lama := v_row.kode_login || '@regu.siplap.id';

    -- B1) Kode login → target (dengan penjaga tabrakan).
    if v_row.kode_login is distinct from v_target then
      if exists (
        select 1 from public.regu x
        where x.kode_login = v_target and x.id <> v_row.id
      ) then
        raise warning 'LEWATI: kode % masih bentrok (harusnya sudah digabung).', v_target;
        continue;
      end if;
      update public.regu
      set kode_login = v_target, nama_regu = v_nama_baru,
          status_aktif = true, is_legacy = false
      where id = v_row.id;
      v_n_rename := v_n_rename + 1;
    else
      -- Kode sudah benar → cukup rapikan nama.
      update public.regu
      set nama_regu = v_nama_baru, status_aktif = true, is_legacy = false
      where id = v_row.id and (nama_regu is distinct from v_nama_baru or not status_aktif);
      if found then v_n_nama := v_n_nama + 1; end if;
    end if;

    -- B2) Email Auth → ikut kode baru.
    if lower(v_email_lama) <> lower(v_email_baru) then
      -- Email target sudah dipegang user auth LAIN?
      v_other_auth := null;
      select u.id into v_other_auth
      from auth.users u
      where lower(u.email) = lower(v_email_baru)
        and (v_row.auth_user_id is null or u.id <> v_row.auth_user_id)
      limit 1;
      if v_other_auth is not null then
        if exists (select 1 from public.regu z where z.auth_user_id = v_other_auth) then
          raise warning 'LEWATI email %: dipakai user auth lain yang masih tertaut.', v_email_baru;
          continue;
        end if;
        delete from auth.users where id = v_other_auth;  -- yatim → bersihkan
      end if;

      if v_row.auth_user_id is not null then
        if v_reset_pin then
          update auth.users
          set email = v_email_baru,
              email_confirmed_at = coalesce(email_confirmed_at, now()),
              encrypted_password = extensions.crypt(v_target, extensions.gen_salt('bf', 10)),
              updated_at = now()
          where id = v_row.auth_user_id;
        else
          update auth.users
          set email = v_email_baru,
              email_confirmed_at = coalesce(email_confirmed_at, now()),
              updated_at = now()
          where id = v_row.auth_user_id;
        end if;
      else
        -- Baris belum tertaut: cari auth user dari email lama.
        select u.id into v_auth_id from auth.users u
        where lower(u.email) = lower(v_email_lama) limit 1;
        if v_auth_id is not null then
          update auth.users
          set email = v_email_baru,
              email_confirmed_at = coalesce(email_confirmed_at, now()),
              updated_at = now()
          where id = v_auth_id;
          update public.regu set auth_user_id = v_auth_id where id = v_row.id;
        else
          raise warning 'Belum ada auth user untuk % — jalankan npm run provision:siplap-v2.', v_target;
        end if;
      end if;
    end if;
  end loop;

  raise notice '==== SELESAI: % duplikat digabung, % kode direname, % nama diperbaiki ====',
    v_n_merge, v_n_rename, v_n_nama;
end $$;

-- ============ 3) VERIFIKASI ============
-- Semua level-1 harus berformat unit.*, tanpa duplikat.
select count(*)                                        as total_level1,
       count(*) filter (where kode_login like 'unit.%') as format_benar,
       count(*) filter (where kode_login not like 'unit.%') as format_sisa,
       count(distinct (unit_key, wilayah_key))          as pasangan_unik
from public.regu
where access_level = 'pelapor-level-1';

-- Sisa duplikat (harus 0 baris)
select unit_key, wilayah_key, count(*)
from public.regu
where access_level = 'pelapor-level-1'
group by 1, 2 having count(*) > 1;

-- Contoh akhir
select kode_login, nama_regu, status_aktif
from public.regu
where access_level = 'pelapor-level-1'
order by wilayah_key, unit_key
limit 12;
