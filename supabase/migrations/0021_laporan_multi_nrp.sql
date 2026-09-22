-- =============================================================
-- SIPLAP — Migration 0022: Multi-NRP pelapor pada laporan
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- Realita lapangan: satu unit terdiri dari beberapa personel
-- (NRP berbeda-beda) yang melapor bersamaan. Kolom nrp_pelapor
-- diubah dari text menjadi text[] sehingga satu laporan bisa
-- memuat daftar NRP — semuanya tetap tampil di dashboard
-- pemantau, detail laporan, PDF, dan Excel.
--
-- Data lama (single NRP, migration 0020) dikonversi otomatis
-- menjadi array berisi satu nilai.
-- =============================================================

-- 1) KONVERSI TIPE KOLOM ------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'laporan'
      and column_name = 'nrp_pelapor'
  ) then
    -- Kolom belum ada sama sekali → buat langsung sebagai text[].
    alter table public.laporan add column nrp_pelapor text[];
  elsif (
    select data_type from information_schema.columns
    where table_schema = 'public'
      and table_name = 'laporan'
      and column_name = 'nrp_pelapor'
  ) = 'text' then
    -- Kolom lama bertipe text (migration 0020) → konversi ke array.
    -- NULL tetap NULL; nilai tunggal dibungkus array berisi 1 elemen.
    alter table public.laporan
      alter column nrp_pelapor type text[]
      using case
        when nrp_pelapor is null then null
        else array[nrp_pelapor]
      end;
  end if;
  -- Jika sudah bertipe ARRAY (migration ini pernah dijalankan), tidak ada aksi.
end $$;

comment on column public.laporan.nrp_pelapor is
  'Daftar NRP pelapor yang diinput saat membuat laporan (satu unit bisa >1 personel) — dipakai pemantau mengenali siapa saja pelapornya.';

-- 2) INDEX (pencarian laporan per NRP, mendukung array) -----------

-- Index btree lama (migration 0020) diganti GIN agar cocok untuk
-- tipe array (mis. nrp_pelapor @> ARRAY['75001234']).
drop index if exists idx_laporan_nrp;
create index if not exists idx_laporan_nrp_gin
  on public.laporan using gin (nrp_pelapor);
