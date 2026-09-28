-- =============================================================
-- SIPLAP — 0028: DIREKTORI PERSONEL (NRP → Pangkat/Nama/Jabatan)
-- =============================================================
-- Sumber data : LAPORAN PERSONEL PWK.xlsx (LAPBUL)
-- Tujuan      : pencocokan NRP di sisi client — pemantau melihat
--               "NRP (PANGKAT — Nama — Jabatan)", pelapor mendapat
--               validasi nama saat mengetik NRP.
--
-- CATATAN:
--  - KHUSUS tabel baru `personel_polri`. Tidak mengubah tabel,
--    RLS, scope, maupun fungsi yang sudah ada.
--  - Import data lewat `npm run import:personel`
--    (scripts/import-personel.mjs, baca xlsx → upsert).
-- =============================================================

create table if not exists public.personel_polri (
  nrp       text primary key,
  nama      text not null,
  pangkat   text not null,
  jabatan   text not null,
  updated_at timestamptz not null default now()
);

comment on table public.personel_polri is
  'Direktori personel Polri Polres Purwakarta (sumber: LAPBUL). Dipakai pencocokan NRP di client.';

-- Import menimpa seluruh baris (xa) — butuh service role (script).
-- Client cukup read.

alter table public.personel_polri enable row level security;

drop policy if exists "personel read authenticated" on public.personel_polri;
create policy "personel read authenticated"
  on public.personel_polri
  for select
  to authenticated
  using (true);

-- Index bantu pencarian nama (validasi NRP di form pelapor).
create index if not exists personel_polri_nama_idx
  on public.personel_polri (lower(nama));
