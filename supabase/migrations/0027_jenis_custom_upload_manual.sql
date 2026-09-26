-- ============================================================
-- 0027 — JENIS LAPORAN CUSTOM (KETIKAN PELAPOR)
-- ============================================================
-- Latar: selain memilih jenis dari master, pelapor boleh mengetik jenis
-- sendiri (mis. "Kegiatan Masyarakat") — khususnya saat menginput laporan
-- kejadian yang awalnya datang dari masyarakat. RLS menolak INSERT
-- jenis_laporan dari role regu, maka pencarian + pendaftaran jenis custom
-- dilakukan lewat RPC SECURITY DEFINER ini:
--   • Nama dirapikan (spasi berlebih dilebur, trim).
--   • Bila jenis dengan nama sama sudah ada (tidak sensitif kapital),
--     kembalikan id yang ada — tidak ada duplikat.
--   • Bila belum ada, daftarkan sebagai jenis baru (aktif) dengan urutan
--     di bawah jenis kategori tersebut. Admin tetap bisa mengubah /
--     menonaktifkan dari master jenis (migration 0023 tetap berlaku).

create or replace function public.pakai_jenis_custom(p_kategori text, p_nama text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nama text;
  v_id   uuid;
  v_max  int;
begin
  if p_kategori not in ('kegiatan','kejadian') then
    raise exception 'Kategori jenis tidak valid';
  end if;

  v_nama := btrim(regexp_replace(coalesce(p_nama, ''), '\s+', ' ', 'g'));
  if v_nama = '' or char_length(v_nama) > 120 then
    raise exception 'Nama jenis custom harus 1-120 karakter';
  end if;

  -- Sudah ada (abaikan kapital) → pakai yang lama, tanpa duplikat.
  select id into v_id
    from public.jenis_laporan
   where kategori = p_kategori
     and lower(nama) = lower(v_nama)
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(max(urutan), 0) + 1 into v_max
    from public.jenis_laporan
   where kategori = p_kategori;

  insert into public.jenis_laporan (kategori, nama, aktif, urutan)
  values (p_kategori, v_nama, true, v_max)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.pakai_jenis_custom(text, text) from public;
revoke all on function public.pakai_jenis_custom(text, text) from anon;
grant execute on function public.pakai_jenis_custom(text, text) to authenticated;
