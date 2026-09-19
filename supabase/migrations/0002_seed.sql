-- =============================================================
-- JAWARA: master username seed for Polres Purwakarta
-- Jalankan setelah 0001_init.sql.
--
-- File ini TIDAK membuat password atau auth.users.
-- Jalankan npm run provision:jawara setelah seluruh migration selesai
-- untuk membuat akun Auth dengan password acak kuat.
-- =============================================================

-- Metadata akses dibuat di sini agar seed dapat dijalankan sebelum 0006.
alter table public.regu
  add column if not exists access_level text not null default 'pelapor-level-1',
  add column if not exists unit_key text,
  add column if not exists wilayah_key text;

alter table public.admin_users
  add column if not exists username text,
  add column if not exists access_level text not null default 'all',
  add column if not exists scope_key text;

create unique index if not exists admin_users_username_key
  on public.admin_users (lower(username))
  where username is not null;

-- Akun pelapor tingkat Polres: 342 akun.
do $$
declare
  item record;
  nomor integer;
begin
  for item in
    select * from (values
      ('Satintelkam', 'intelkam', 30),
      ('Satreskrim', 'reskrim', 73),
      ('Satresnarkoba', 'narkoba', 35),
      ('Satbinmas', 'binmas', 9),
      ('Satsamapta', 'samapta', 44),
      ('Pam Obvit Samapta', 'pamobvit', 24),
      ('Satlantas', 'lantas', 96),
      ('Satpolairud', 'polair', 7),
      ('Sattahti', 'tahti', 10),
      ('SPKT', 'spkt', 14)
    ) as units(nama, unit_key, jumlah)
  loop
    for nomor in 1..item.jumlah loop
      insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key)
      values (
        item.nama || ' Pelapor ' || lpad(nomor::text, 2, '0'),
        item.unit_key || '.pelapor' || lpad(nomor::text, 2, '0'),
        true, 'pelapor-level-2', item.unit_key, null
      )
      on conflict (kode_login) do update set
        nama_regu = excluded.nama_regu,
        status_aktif = true,
        access_level = excluded.access_level,
        unit_key = excluded.unit_key,
        wilayah_key = excluded.wilayah_key;
    end loop;
  end loop;
end $$;

-- Akun pelapor tingkat Polsek: 289 akun.
do $$
declare
  item record;
  nomor integer;
begin
  for item in
    select * from (values
      ('Purwakarta Kota', 'kota', 35),
      ('Plered', 'plered', 25),
      ('Jatiluhur', 'jatiluhur', 27),
      ('Bungursari', 'bungursari', 27),
      ('Campaka', 'campaka', 22),
      ('Cibatu', 'cibatu', 23),
      ('Pasawahan', 'pasawahan', 24),
      ('Darangdan', 'darangdan', 16),
      ('Wanayasa', 'wanayasa', 18),
      ('Maniis', 'maniis', 14),
      ('Sukatani', 'sukatani', 16),
      ('Sukasari', 'sukasari', 16),
      ('Kiarapedes', 'kiarapedes', 12),
      ('Bojong', 'bojong', 14)
    ) as units(nama, wilayah_key, jumlah)
  loop
    for nomor in 1..item.jumlah loop
      insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key)
      values (
        'Polsek ' || item.nama || ' Pelapor ' || lpad(nomor::text, 2, '0'),
        item.wilayah_key || '.pelapor' || lpad(nomor::text, 2, '0'),
        true, 'pelapor-level-1', null, item.wilayah_key
      )
      on conflict (kode_login) do update set
        nama_regu = excluded.nama_regu,
        status_aktif = true,
        access_level = excluded.access_level,
        unit_key = excluded.unit_key,
        wilayah_key = excluded.wilayah_key;
    end loop;
  end loop;
end $$;

-- Pemantau all-access: Kapolres, Wakapolres, dan Admin Utama.
insert into public.admin_users (nama, email, username, role, access_level, scope_key)
values
  ('Kapolres', 'polres.kapolres@monitor.siplap.id', 'polres.kapolres', 'admin', 'all', null),
  ('Wakapolres', 'polres.wakapolres@monitor.siplap.id', 'polres.wakapolres', 'admin', 'all', null),
  ('Admin Utama', 'admin@polres.go.id', 'polres.admin', 'admin', 'all', null)
on conflict (email) do update set
  nama = excluded.nama,
  username = excluded.username,
  role = excluded.role,
  access_level = excluded.access_level,
  scope_key = excluded.scope_key;

-- Pemantau sesuai fungsi: 10 akun.
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('KASAT INTEL', 'intelkam'),
      ('KASAT RESKRIM', 'reskrim'),
      ('KASATRESNARKOBA', 'narkoba'),
      ('KASAT BINMAS', 'binmas'),
      ('KASAT SAMAPTA', 'samapta'),
      ('PAMOBVIT SAMAPTA', 'pamobvit'),
      ('KASAT LANTAS', 'lantas'),
      ('KASAT POLAIR', 'polair'),
      ('KASAT TAHTI', 'tahti'),
      ('SPKT', 'spkt')
    ) as units(nama, unit_key)
  loop
    insert into public.admin_users (nama, email, username, role, access_level, scope_key)
    values (
      item.nama,
      item.unit_key || '.kasat@monitor.siplap.id',
      item.unit_key || '.kasat',
      'pimpinan', 'fungsi', item.unit_key
    )
    on conflict (email) do update set
      nama = excluded.nama,
      username = excluded.username,
      role = excluded.role,
      access_level = excluded.access_level,
      scope_key = excluded.scope_key;
  end loop;
end $$;

-- Pemantau sesuai wilayah: 14 Kapolsek.
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('Purwakarta Kota', 'kota'), ('Plered', 'plered'),
      ('Jatiluhur', 'jatiluhur'), ('Bungursari', 'bungursari'),
      ('Campaka', 'campaka'), ('Cibatu', 'cibatu'),
      ('Pasawahan', 'pasawahan'), ('Darangdan', 'darangdan'),
      ('Wanayasa', 'wanayasa'), ('Maniis', 'maniis'),
      ('Sukatani', 'sukatani'), ('Sukasari', 'sukasari'),
      ('Kiarapedes', 'kiarapedes'), ('Bojong', 'bojong')
    ) as units(nama, wilayah_key)
  loop
    insert into public.admin_users (nama, email, username, role, access_level, scope_key)
    values (
      'KAPOLSEK ' || upper(item.nama),
      item.wilayah_key || '.kapolsek@monitor.siplap.id',
      item.wilayah_key || '.kapolsek',
      'pimpinan', 'wilayah', item.wilayah_key
    )
    on conflict (email) do update set
      nama = excluded.nama,
      username = excluded.username,
      role = excluded.role,
      access_level = excluded.access_level,
      scope_key = excluded.scope_key;
  end loop;
end $$;

-- Sanity check: 631 pelapor dan 27 pemantau/admin.
do $$
declare
  n_pelapor integer;
  n_pemantau integer;
begin
  select count(*) into n_pelapor from public.regu
    where kode_login like '%.pelapor%';
  select count(*) into n_pemantau from public.admin_users
    where username is not null;
  if n_pelapor < 631 then
    raise exception 'Seed JAWARA gagal: hanya % akun pelapor', n_pelapor;
  end if;
  if n_pemantau < 27 then
    raise exception 'Seed JAWARA gagal: hanya % akun pemantau/admin', n_pemantau;
  end if;
  raise notice 'Seed JAWARA selesai: % pelapor, % pemantau/admin.', n_pelapor, n_pemantau;
end $$;
