-- =============================================================
-- SIPLAP — Migration 0019: Pelacakan posisi realtime pelapor
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- Tabel `posisi`: SATU baris per pelapor (regu), selalu di-UPDATE
-- (bukan riwayat). App pelapor mengirim GPS tiap 60 detik selama
-- aplikasi terbuka; dashboard membaca untuk peta personel live.
--
-- RLS:
--   - select : authenticated (dipakai peta pemantau; cakupan lebih
--     rinci dibatasi di klien via can_read_laporan).
--   - insert/update : pemilik baris saja (regu_id = auth identity).
--   - delete : tidak diberikan ke klien (baris di-retensi sebagai
--     "posisi terakhir"; refresh otomatis saat pelapor aktif lagi).
--
-- Realtime: table masuk publication supabase_realtime agar peta
-- dashboard update tanpa reload.
-- =============================================================

-- 1) TABEL POSISI ------------------------------------------------

create table if not exists public.posisi (
  regu_id      uuid primary key references public.regu(id) on delete cascade,
  latitude     double precision not null,
  longitude    double precision not null,
  accuracy_m   double precision,
  kecepatan_mps double precision,
  diupdate_pada timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.posisi is
  'Posisi GPS terkini tiap pelapor — satu baris per regu, selalu di-update (realtime tracking).';

alter table public.posisi enable row level security;

-- Baca: semua terautentikasi (pemantau/pelapor). Penyaringan cakupan
-- per-role dilakukan di sisi klien dengan can_read_laporan.
drop policy if exists "posisi readable by authenticated" on public.posisi;
create policy "posisi readable by authenticated"
on public.posisi for select to authenticated using (true);

-- Tulis: hanya pemilik posisi (pelapor yang sedang login).
drop policy if exists "posisi insert own" on public.posisi;
create policy "posisi insert own"
on public.posisi for insert to authenticated
with check (regu_id = public.current_regu_id());

drop policy if exists "posisi update own" on public.posisi;
create policy "posisi update own"
on public.posisi for update to authenticated
using (regu_id = public.current_regu_id())
with check (regu_id = public.current_regu_id());

-- Indeks bantu (urutan daftar & pembersihan manual bila perlu).
create index if not exists idx_posisi_diupdate on public.posisi (diupdate_pada desc);

-- 2) REALTIME ----------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posisi'
    ) then
      execute 'alter publication supabase_realtime add table public.posisi';
    end if;
  end if;
end $$;
