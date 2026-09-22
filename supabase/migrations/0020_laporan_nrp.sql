-- =============================================================
-- SIPLAP — Migration 0021: NRP pelapor pada laporan
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- Tujuan: pelapor cukup menginput NRP-nya saat membuat laporan;
-- pemantau tetap tahu SIAPA yang melapor karena NRP tampil di
-- dashboard, detail laporan, dan PDF (bisa dicocokkan dengan
-- daftar personel).
--
-- Catatan: NRP disimpan per-laporan (snapshot saat melapor), bukan
-- di tabel regu, agar laporan lama tidak berubah bila personel
-- pindah/ganti NRP.
-- =============================================================

-- 1) KOLOM BARU ---------------------------------------------------

alter table public.laporan add column if not exists nrp_pelapor text;

comment on column public.laporan.nrp_pelapor is
  'NRP pelapor yang diinput saat membuat laporan — dipakai pemantau mengenali siapa pelapornya.';

-- 2) INDEX (pencarian laporan per NRP) ----------------------------

create index if not exists idx_laporan_nrp on public.laporan (nrp_pelapor);
