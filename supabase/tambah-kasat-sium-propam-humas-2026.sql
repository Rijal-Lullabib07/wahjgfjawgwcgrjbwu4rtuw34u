-- =============================================================
-- SIPLAP — TAMBAHAN KASAT & SATUAN SIUM / PROPAM / HUMAS (2026)
-- =============================================================
-- Tujuan  : menambah 6 akun tingkat Polres:
--   Pemantau (admin_users, access_level='fungsi', role='pimpinan'):
--     sat.sium   → KASAT SIUM    (pantau unit sium   di semua Polsek + satuan)
--     si.propam  → KASI PROPAM   (pantau unit propam di semua Polsek + satuan)
--     sat.humas  → KASAT HUMAS   (pantau unit humas  di semua Polsek + satuan)
--   Pelapor level-2 (regu, wilayah_key = null → folder satuan):
--     sat.sium.unit1   → Satsium Unit 1
--     sat.propam.unit1 → Satpropam Unit 1
--     sat.humas.unit1  → Sathumas Unit 1
-- Cakupan Kasat OTOMATIS (RLS can_read_monitor_scope by unit_key):
--   masing-masing memantau 15 regu = 1 satuan + 14 unit Polsek.
-- Aman    : INSERT-ONLY. Tidak mengubah tabel, RLS, fungsi, trigger,
--           akun existing, atau objek server lain sedikitpun.
-- Idempoten: on conflict do update HANYA untuk baris baru ini.
-- Catatan: baris admin_users dibuat tanpa akun Auth dulu (password diset
--          oleh scripts/provision-kasat-sium-propam-humas-2026.mjs).
-- =============================================================

-- 1) Pemantau fungsi: 3 Kasat/Kasi baru -------------------------
insert into public.admin_users (nama, email, username, role, access_level, scope_key)
values
  ('KASAT SIUM',  'sat.sium@monitor.siplap.id',   'sat.sium',  'pimpinan', 'fungsi', 'sium'),
  ('KASI PROPAM', 'si.propam@monitor.siplap.id',  'si.propam', 'pimpinan', 'fungsi', 'propam'),
  ('KASAT HUMAS', 'sat.humas@monitor.siplap.id',  'sat.humas', 'pimpinan', 'fungsi', 'humas')
on conflict (email) do update set
  nama = excluded.nama, username = excluded.username, role = excluded.role,
  access_level = excluded.access_level, scope_key = excluded.scope_key;

-- 2) Pelapor level-2: 1 satuan per fungsi baru ------------------
insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key, is_legacy)
values
  ('Satsium Unit 1',    'sat.sium.unit1',   true, 'pelapor-level-2', 'sium',   null, false),
  ('Sipropam Unit 1',   'sat.propam.unit1', true, 'pelapor-level-2', 'propam', null, false),
  ('Sathumas Unit 1',   'sat.humas.unit1',  true, 'pelapor-level-2', 'humas',  null, false)
on conflict (kode_login) do update set
  nama_regu    = excluded.nama_regu,
  status_aktif = excluded.status_aktif,
  access_level = excluded.access_level,
  unit_key     = excluded.unit_key,
  wilayah_key  = excluded.wilayah_key,
  is_legacy    = false;

-- Verifikasi cepat:
-- select username, scope_key from public.admin_users
--   where username in ('sat.sium','si.propam','sat.humas');
-- select unit_key, count(*) from public.regu
--   where unit_key in ('sium','propam','humas') group by unit_key;
--   → sium 15, propam 15, humas 15 (1 satuan + 14 polsek)
