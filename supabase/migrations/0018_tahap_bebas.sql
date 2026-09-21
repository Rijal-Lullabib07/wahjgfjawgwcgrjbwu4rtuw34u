-- =============================================================
-- SIPLAP — Migration 0018: Tahap bebas untuk laporan baru
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- Alur baru (permintaan): pelapor memilih TAHAP sebelum jenis:
--   - Kegiatan: Awal | Lengkap
--   - Kejadian: Awal | Update | Lengkap
-- Artinya laporan baru (tanpa induk) boleh langsung dibuat dengan
-- tahap 'update' atau 'lengkap' (mis. laporan kejadian yang langsung
-- selesai). Yang TETAP dilarang:
--   - turunan bertahap 'awal'
--   - menambah turunan ke rangkaian yang sudah 'lengkap'
--   - kategori turunan berbeda dari induk
-- =============================================================

create or replace function public.validate_laporan_turunan()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_parent public.laporan%rowtype;
begin
  if new.parent_id is null then
    -- Laporan baru: tahap bebas (awal/update/lengkap) sesuai pilihan
    -- pelapor di form. 'lengkap' berarti langsung ditutup.
    return new;
  end if;

  select * into v_parent from public.laporan where id = new.parent_id;
  if not found then
    raise exception 'Laporan induk tidak ditemukan';
  end if;

  if v_parent.regu_id <> new.regu_id then
    raise exception 'Hanya pembuat laporan awal yang bisa melanjutkan';
  end if;
  if v_parent.kategori <> new.kategori then
    raise exception 'Kategori turunan harus sama dengan laporan awal';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'Turunan hanya boleh menempel ke laporan awal';
  end if;
  if new.tahap = 'awal' then
    raise exception 'Turunan tidak boleh bertahap awal';
  end if;
  -- Laporan lengkap menutup rangkaian.
  if v_parent.tahap = 'lengkap' then
    raise exception 'Rangkaian laporan sudah ditutup (lengkap)';
  end if;

  new.perihal := coalesce(nullif(trim(new.perihal), ''), v_parent.perihal);
  return new;
end;
$$;
