-- =============================================================
-- SIPLAP — OPS: RESET STRUKTUR AKUN v2 (total reset akun)
-- =============================================================
-- Semua langkah (HAPUS + ISI AKUN BARU) terkunci di belakang dua
-- sakelar v_confirm. Jalankan file ini SEKALI saja dengan KEDUA
-- sakelar true — skrip idempoten, aman bila perlu diulang.
--
-- Struktur baru (SEMUA akun lama dihapus & dibuat ulang):
--
--   PEMANTAU (25):
--     kapolres.purwakarta        (all, admin)      ← baru (ganti polres.kapolres)
--     wakapolres.purwakarta      (all, pimpinan)   ← baru (ganti polres.wakapolres)
--     kabag.ops                  (all, admin)      ← BARU
--     sat.intelkam … sat.tahti   (fungsi, 8 kasat) ← BARU
--     kapolsek.<polsek>          (wilayah, 14)     ← BARU (ganti <polsek>.kapolsek)
--
--   PELAPOR SATUAN POLRES (23, access_level pelapor-level-2):
--     sat.intelkam.unit1..4, sat.reskrim.unit1..5, sat.resnarkoba.unit1..2,
--     sat.binmas.unit1, sat.samapta.unit1..3, sat.lantas.unit1..5,
--     sat.polair.unit1..2, sat.tahti.unit1
--
--   PELAPOR POLSEK (84, access_level pelapor-level-1):
--     unit.spkt.<polsek>, unit.intelkam.<polsek>, unit.reskrim.<polsek>,
--     unit.binmas.<polsek>, unit.samapta.<polsek>, unit.lantas.<polsek>
--     untuk 14 polsek (seragam), mis. unit.spkt.jatiluhur.
--
-- Yang dihapus: SEMUA akun regu & admin_users (termasuk polres.kapolres
-- & polres.wakapolres yang diganti username, kasat lama *.kasat,
-- kapolsek lama <polsek>.kapolsek, admin utama polres.admin, unit
-- polsek bhabinkamtibmas/propam/sium, satuan polres lama *.polres)
-- beserta SELURUH LAPORAN/FOTO/VIDEO/POSI (database dikosongkan).
-- Auth user-nya juga dihapus.
--
-- File media di bucket Storage laporan-foto dikosongkan TERPISAH via
-- Dashboard/Storage API — Supabase memblokir DELETE SQL langsung ke
-- storage.objects (lihat catatan langkah 2 di bagian bawah).
--
-- Data konfigurasi yang DIPERTAHANKAN: jenis_laporan, buckets,
-- struktur tabel & RLS.
--
-- CARA PAKAI
--   1. (Opsional) Jalankan apa adanya → PREVIEW, tidak mengubah apa pun.
--   2. Ubah KEDUA v_confirm di bawah menjadi true (bagian 2 & bagian 3,
--      masing-masing ada penanda "←←← UBAH KE true"), jalankan seluruh
--      file → hapus semua + isi akun baru sekaligus.
--   3. Setelah sukses, jalankan `npm run provision:siplap-v2` untuk
--      membuat akun Auth + password baru.
--
-- PERINGATAN: eksekusi dengan v_confirm = true TIDAK BISA dibatalkan.
-- =============================================================

-- ============ 1) PREVIEW (aman) =====================================
do $$
declare
  v_confirm boolean := false;  -- preview: jangan diubah
  v_n int;
begin
  if v_confirm then
    raise notice 'DIBATALKAN: blok preview tidak untuk dieksekusi.';
    return;
  end if;

  create temp table target_regu on commit drop as
    select r.id, r.kode_login from public.regu r;

  create temp table target_monitor on commit drop as
    select a.id, a.username from public.admin_users a;

  select count(*) into v_n from target_regu;
  raise notice 'Regu (pelapor) yang AKAN dihapus  : %', v_n;
  select count(*) into v_n from target_monitor;
  raise notice 'Pemantau yang AKAN dihapus          : %', v_n;
  select count(*) into v_n
    from public.laporan l join target_regu t on t.id = l.regu_id;
  raise notice 'Laporan yang AKAN dihapus           : %', v_n;
  select count(*) into v_n
    from public.laporan_foto f
    join public.laporan l on l.id = f.laporan_id
    join target_regu t on t.id = l.regu_id;
  raise notice 'Foto yang AKAN dihapus              : %', v_n;
  select count(*) into v_n
    from public.laporan_video v
    join public.laporan l on l.id = v.laporan_id
    join target_regu t on t.id = l.regu_id;
  raise notice 'Video yang AKAN dihapus             : %', v_n;
end $$;

-- ============ 2) EKSEKUSI (hapus permanen) ==========================
do $$
declare
  v_confirm boolean := true;  -- ←←← UBAH KE true UNTUK MENGHAPUS
  v_n int;
begin
  if not v_confirm then
    raise notice 'DIBATALKAN: v_confirm bagian 2 masih false. Tidak ada yang dihapus.';
    return;
  end if;

  -- Nama tabel beda dari blok preview (bagian 1): saat seluruh file
  -- dijalankan dalam SATU transaksi, temp table preview masih ada,
  -- sehingga nama yang sama akan gagal 42P07 "already exists".
  create temp table del_regu on commit drop as
    select r.id, r.kode_login,
           lower(r.kode_login) || '@regu.siplap.id' as email
    from public.regu r;

  create temp table del_monitor on commit drop as
    select a.id, a.username, lower(a.email) as email
    from public.admin_users a;

  -- 1) Pemantau: folder_reads & push_subscriptions ikut cascade.
  delete from public.admin_users a
  where a.id in (select id from del_monitor);
  get diagnostics v_n = row_count;
  raise notice 'Pemantau dihapus : %', v_n;

  -- 2) FILE MEDIA STORAGE (bucket laporan-foto) TIDAK dihapus di sini.
  --    Supabase memblokir DELETE langsung ke storage.objects lewat
  --    trigger storage.protect_delete (error 42501) dan trigger itu
  --    tidak bisa dimatikan — penghapusan file wajib lewat Storage API.
  --    Karena ini reset TOTAL, kosongkan bucket via Dashboard:
  --    Storage → laporan-foto → menu ⋯ → "Empty bucket". Boleh
  --    dilakukan sebelum atau sesudah skrip ini; file yatim yang
  --    tertinggal tidak mengganggu apa pun.

  -- 3) Hapus regu → laporan, foto, video, posisi, push, reminder ikut
  --    terhapus otomatis (FK on delete cascade).
  delete from public.regu r
  where r.id in (select id from del_regu);
  get diagnostics v_n = row_count;
  raise notice 'Regu dihapus     : %', v_n;

  -- 4) Hapus akun Auth milik akun yang dihapus.
  delete from auth.users
  where lower(email) in (select email from del_regu)
     or lower(email) in (select email from del_monitor);

  raise notice '==== RESET SELESAI — lanjut provisioning (bagian 3) ====';
end $$;

-- ============ 3) PROVISIONING PEMANTAU & PELAPOR BARU ===============
-- Terkunci di belakang v_confirm sendiri: tanpa true, TIDAK ada akun
-- yang di-insert (mencegah campur akun lama + baru).
do $$
declare
  v_confirm boolean := true;  -- ←←← UBAH KE true UNTUK MENGISI AKUN BARU
  w record;
  u record;
begin
  if not v_confirm then
    raise notice 'DIBATALKAN: v_confirm bagian 3 masih false. Provisioning dilewati.';
    return;
  end if;

  -- 3a) Pemantau all-access + kasat ---------------------------------
  insert into public.admin_users (nama, email, username, role, access_level, scope_key)
  values
    ('KAPOLRES PURWAKARTA',   'kapolres.purwakarta@monitor.siplap.id',   'kapolres.purwakarta',   'admin',    'all', null),
    ('WAKAPOLRES PURWAKARTA', 'wakapolres.purwakarta@monitor.siplap.id', 'wakapolres.purwakarta', 'pimpinan', 'all', null),
    ('KABAG OPERASIONAL',     'kabag.ops@monitor.siplap.id',             'kabag.ops',             'admin',    'all', null),
    ('KASAT INTELKAM',    'sat.intelkam@monitor.siplap.id',   'sat.intelkam',   'pimpinan', 'fungsi', 'intelkam'),
    ('KASAT RESKRIM',     'sat.reskrim@monitor.siplap.id',    'sat.reskrim',    'pimpinan', 'fungsi', 'reskrim'),
    ('KASAT RESNARKOBA',  'sat.resnarkoba@monitor.siplap.id', 'sat.resnarkoba', 'pimpinan', 'fungsi', 'resnarkoba'),
    ('KASAT BINMAS',      'sat.binmas@monitor.siplap.id',     'sat.binmas',     'pimpinan', 'fungsi', 'binmas'),
    ('KASAT SAMAPTA',     'sat.samapta@monitor.siplap.id',    'sat.samapta',    'pimpinan', 'fungsi', 'samapta'),
    ('KASAT LANTAS',      'sat.lantas@monitor.siplap.id',     'sat.lantas',     'pimpinan', 'fungsi', 'lantas'),
    ('KASAT POLAIR',      'sat.polair@monitor.siplap.id',     'sat.polair',     'pimpinan', 'fungsi', 'polair'),
    ('KASAT TAHTI',       'sat.tahti@monitor.siplap.id',      'sat.tahti',      'pimpinan', 'fungsi', 'tahti')
  on conflict (lower(username)) where username is not null do update
    set nama = excluded.nama,
        email = excluded.email,
        role = excluded.role,
        access_level = excluded.access_level,
        scope_key = excluded.scope_key;

  -- 3b) Pemantau wilayah: 14 Kapolsek -------------------------------
  for w in
    select * from (values
      ('kota','Purwakarta Kota'), ('plered','Plered'),
      ('jatiluhur','Jatiluhur'), ('bungursari','Bungursari'),
      ('campaka','Campaka'), ('cibatu','Cibatu'),
      ('pasawahan','Pasawahan'), ('darangdan','Darangdan'),
      ('wanayasa','Wanayasa'), ('maniis','Maniis'),
      ('sukatani','Sukatani'), ('sukasari','Sukasari'),
      ('kiarapedes','Kiarapedes'), ('bojong','Bojong')
    ) as t(wilayah, nama)
  loop
    insert into public.admin_users (nama, email, username, role, access_level, scope_key)
    values (
      'KAPOLSEK ' || upper(w.nama),
      'kapolsek.' || w.wilayah || '@monitor.siplap.id',
      'kapolsek.' || w.wilayah,
      'pimpinan', 'wilayah', w.wilayah
    )
    on conflict (lower(username)) where username is not null do update
      set nama = excluded.nama,
          email = excluded.email,
          role = excluded.role,
          access_level = excluded.access_level,
          scope_key = excluded.scope_key;
  end loop;

  -- 3c) Pelapor satuan Polres (level-2): 23 akun --------------------
  insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key, is_legacy)
  values
    ('Satintelkam Unit 1', 'sat.intelkam.unit1', true, 'pelapor-level-2', 'intelkam', null, false),
    ('Satintelkam Unit 2', 'sat.intelkam.unit2', true, 'pelapor-level-2', 'intelkam', null, false),
    ('Satintelkam Unit 3', 'sat.intelkam.unit3', true, 'pelapor-level-2', 'intelkam', null, false),
    ('Satintelkam Unit 4', 'sat.intelkam.unit4', true, 'pelapor-level-2', 'intelkam', null, false),
    ('Satreskrim Unit 1',  'sat.reskrim.unit1',  true, 'pelapor-level-2', 'reskrim',  null, false),
    ('Satreskrim Unit 2',  'sat.reskrim.unit2',  true, 'pelapor-level-2', 'reskrim',  null, false),
    ('Satreskrim Unit 3',  'sat.reskrim.unit3',  true, 'pelapor-level-2', 'reskrim',  null, false),
    ('Satreskrim Unit 4',  'sat.reskrim.unit4',  true, 'pelapor-level-2', 'reskrim',  null, false),
    ('Satreskrim Unit 5',  'sat.reskrim.unit5',  true, 'pelapor-level-2', 'reskrim',  null, false),
    ('Satresnarkoba Unit 1','sat.resnarkoba.unit1', true, 'pelapor-level-2', 'resnarkoba', null, false),
    ('Satresnarkoba Unit 2','sat.resnarkoba.unit2', true, 'pelapor-level-2', 'resnarkoba', null, false),
    ('Satbinmas Unit 1',   'sat.binmas.unit1',   true, 'pelapor-level-2', 'binmas',   null, false),
    ('Satsamapta Unit 1',  'sat.samapta.unit1',  true, 'pelapor-level-2', 'samapta',  null, false),
    ('Satsamapta Unit 2',  'sat.samapta.unit2',  true, 'pelapor-level-2', 'samapta',  null, false),
    ('Satsamapta Unit 3',  'sat.samapta.unit3',  true, 'pelapor-level-2', 'samapta',  null, false),
    ('Satlantas Unit 1',   'sat.lantas.unit1',   true, 'pelapor-level-2', 'lantas',   null, false),
    ('Satlantas Unit 2',   'sat.lantas.unit2',   true, 'pelapor-level-2', 'lantas',   null, false),
    ('Satlantas Unit 3',   'sat.lantas.unit3',   true, 'pelapor-level-2', 'lantas',   null, false),
    ('Satlantas Unit 4',   'sat.lantas.unit4',   true, 'pelapor-level-2', 'lantas',   null, false),
    ('Satlantas Unit 5',   'sat.lantas.unit5',   true, 'pelapor-level-2', 'lantas',   null, false),
    ('Satpolairud Unit 1', 'sat.polair.unit1',   true, 'pelapor-level-2', 'polair',   null, false),
    ('Satpolairud Unit 2', 'sat.polair.unit2',   true, 'pelapor-level-2', 'polair',   null, false),
    ('Sattahti Unit 1',    'sat.tahti.unit1',    true, 'pelapor-level-2', 'tahti',    null, false)
  on conflict (kode_login) do update
    set nama_regu = excluded.nama_regu,
        status_aktif = excluded.status_aktif,
        access_level = excluded.access_level,
        unit_key = excluded.unit_key,
        wilayah_key = excluded.wilayah_key,
        is_legacy = excluded.is_legacy;

  -- 3d) Pelapor Polsek (level-1): 6 unit × 14 polsek ----------------
  for w in
    select * from (values
      ('kota','Purwakarta Kota'), ('plered','Plered'),
      ('jatiluhur','Jatiluhur'), ('bungursari','Bungursari'),
      ('campaka','Campaka'), ('cibatu','Cibatu'),
      ('pasawahan','Pasawahan'), ('darangdan','Darangdan'),
      ('wanayasa','Wanayasa'), ('maniis','Maniis'),
      ('sukatani','Sukatani'), ('sukasari','Sukasari'),
      ('kiarapedes','Kiarapedes'), ('bojong','Bojong')
    ) as t(wilayah, nama)
  loop
    for u in
      select * from (values
        ('spkt','SPKT'), ('intelkam','Intelkam'), ('reskrim','Reskrim'),
        ('binmas','Binmas'), ('samapta','Samapta'), ('lantas','Lantas')
      ) as t(unit, label)
    loop
      insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key, is_legacy)
      values (
        'Polsek ' || w.nama || ' Unit ' || u.label,
        'unit.' || u.unit || '.' || w.wilayah,
        true, 'pelapor-level-1', u.unit, w.wilayah, false
      )
      on conflict (kode_login) do update
        set nama_regu = excluded.nama_regu,
            status_aktif = excluded.status_aktif,
            access_level = excluded.access_level,
            unit_key = excluded.unit_key,
            wilayah_key = excluded.wilayah_key,
            is_legacy = excluded.is_legacy;
    end loop;
  end loop;

  raise notice '==== PROVISIONING SELESAI: lanjut npm run provision:siplap-v2 ====';
end $$;

-- ============ 4) VERIFIKASI =========================================
-- Harus: 23 regu level-2 + 84 regu level-1; pemantau TEPAT 25.
select access_level, count(*) from public.regu group by access_level;
select role, access_level, count(*) from public.admin_users group by role, access_level;

select count(*) as total_pemantau from public.admin_users;  -- harus 25
select count(*) as total_regu from public.regu;             -- harus 107
