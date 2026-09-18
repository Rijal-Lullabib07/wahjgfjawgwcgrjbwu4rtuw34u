-- =============================================================
-- SIPLAP - Migration 0005: perketat RLS upload foto
-- Jalankan setelah migration sebelumnya di Supabase SQL Editor.
-- =============================================================

-- Folder Storage harus sama dengan regu dari sesi Auth yang sedang aktif.
-- Ini juga menghindari policy lama yang hanya memeriksa apakah UUID folder
-- tersebut ada di tabel regu.
drop policy if exists "regu upload own folder" on storage.objects;

create policy "regu upload own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'laporan-foto'
  and (storage.foldername(name))[1]::uuid = public.current_regu_id()
);

-- Pastikan metadata foto hanya dapat dibuat untuk laporan milik regu aktif.
drop policy if exists "foto insert via laporan" on public.laporan_foto;

create policy "foto insert via laporan"
on public.laporan_foto for insert to authenticated
with check (
  exists (
    select 1
    from public.laporan l
    where l.id = laporan_id
      and l.regu_id = public.current_regu_id()
  )
);