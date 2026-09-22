-- =============================================================
-- SIPLAP — Migration 0022: Pastikan trigger tahap bebas aktif
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- Gejala: "Gagal membuat laporan: Laporan baru harus bertahap awal
-- (percobaan ke-2)" — pesan ini hanya ada di fungsi trigger VERSI
-- LAMA (0014). Migration 0017 sudah melonggarkan aturan (laporan
-- baru boleh langsung 'update'/'lengkap'), tetapi karena 0014
-- ternyata dijalankan SETELAH 0017 di database, fungsi trigger
-- tertimpa kembali ke versi lama.
--
-- Migration ini mengembalikan fungsi trigger ke versi 0017 dan
-- memastikan trigger-nya terpasang. Jika 0014 dijalankan lagi
-- kemudian, jalankan file ini SEKALI lagi setelahnya.
-- =============================================================

-- 1) FUNGSI TRIGGER VERSI BARU (identik dengan 0017) ---------------

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

-- 2) PASTIKAN TRIGGER TERPASANG -----------------------------------

drop trigger if exists trg_laporan_turunan on public.laporan;
create trigger trg_laporan_turunan
  before insert on public.laporan
  for each row execute function public.validate_laporan_turunan();
