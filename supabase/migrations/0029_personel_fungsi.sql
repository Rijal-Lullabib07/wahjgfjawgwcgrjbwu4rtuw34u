-- =============================================================
-- SIPLAP — 0029: PERSONEL + FUNGSI/SATUAN/STATUS (DATA PERSONEL FIX)
-- =============================================================
-- Sumber data : DATA PERSONEL FIX.xlsx (kolom baru FUNGSI, SATUAN,
--               STATUS — semua baris berstatus AKTIF).
-- Tujuan      : validasi NRP di form pelapor menampilkan
--               "PANGKAT Nama — Jabatan — FUNGSI", dan FUNGSI ikut
--               tampil di layar pemantau/admin serta export.
--
-- CATATAN:
--  - KHUSUS kolom baru di `personel_polri`. Tidak mengubah tabel lain,
--    RLS, scope, maupun fungsi yang sudah ada.
--  - Import data lewat `node scripts/import-personel.mjs "DATA PERSONEL FIX.xlsx"`
--    (upsert — NRP lama yang tidak ada di file tetap tersimpan).
--  - Fallback lama: jika file tidak punya kolom FUNGSI/SATUAN/STATUS,
--    kolom diisi dari JABATAN (fungsi) & NULL (satuan/status) — see script.
-- =============================================================

alter table public.personel_polri
  add column if not exists fungsi  text,
  add column if not exists satuan  text,
  add column if not exists status  text;

comment on column public.personel_polri.fungsi is
  'Fungsi personel dari LAPBUL (DATA PERSONEL FIX): RESKRIM, SAMAPTA, LANTAS, BINMAS, dst.';
comment on column public.personel_polri.satuan is
  'Satuan personel dari LAPBUL (DATA PERSONEL FIX): POLRES PURWAKARTA, POLSEK <nama>, dst.';
comment on column public.personel_polri.status is
  'Status kepegawaian dari LAPBUL (DATA PERSONEL FIX): AKTIF, dst.';

-- Index bantu filter per fungsi (statistik/pemantau per fungsi).
create index if not exists personel_polri_fungsi_idx
  on public.personel_polri (lower(fungsi));
