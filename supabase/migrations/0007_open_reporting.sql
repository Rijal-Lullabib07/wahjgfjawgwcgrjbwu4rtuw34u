-- Pelaporan tidak lagi dibatasi oleh batas waktu atau kuota foto per siklus.
-- Metadata siklus tetap disimpan untuk kompatibilitas laporan lama.

drop trigger if exists trg_foto_quota on public.laporan_foto;