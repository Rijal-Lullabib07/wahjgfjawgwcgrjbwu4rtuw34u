-- =============================================================
-- SIPLAP — Migration 0015: Pelaporan Kegiatan & Kejadian
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- Perubahan inti:
--   1) Tabel master `jenis_laporan` (pilihan Kegiatan = program kerja,
--      Kejadian = temuan). TIDAK ADA policy DELETE → admin hanya bisa
--      tambah & edit (aktif/nonaktif), tidak bisa menghapus.
--   2) Kolom baru di `laporan`: kategori, jenis_id, tahap, parent_id,
--      perihal. Thread turunan: Laporan Awal → Update Situasi →
--      Laporan Lengkap (semua anak menunjuk ke laporan induk via
--      parent_id).
--   3) Trigger validasi: anak wajib dibuat oleh pelapor yang sama
--      dengan induk dan kategori yang sama (hanya pembuat bisa
--      melanjutkan).
--   4) folder_laporan() diperbarui agar membawa kolom baru +
--      child_count untuk tampilan rangkaian (thread) di monitoring.
--   5) Laporan lama otomatis dianggap kategori 'kegiatan', tahap 'awal'.
-- =============================================================

-- 1) MASTER JENIS LAPORAN ----------------------------------------

create table if not exists public.jenis_laporan (
  id         uuid primary key default gen_random_uuid(),
  kategori   text not null check (kategori in ('kegiatan','kejadian')),
  nama       text not null,
  aktif      boolean not null default true,
  urutan     int not null default 0,
  created_at timestamptz not null default now(),
  unique (kategori, nama)
);

-- RLS: semua terautentikasi boleh baca; hanya admin penuh boleh
-- tambah/edit. Tidak ada policy delete → hapus tidak mungkin dari API.
alter table public.jenis_laporan enable row level security;

drop policy if exists "jenis readable by authenticated" on public.jenis_laporan;
create policy "jenis readable by authenticated"
on public.jenis_laporan for select to authenticated using (true);

drop policy if exists "jenis admin insert" on public.jenis_laporan;
create policy "jenis admin insert"
on public.jenis_laporan for insert to authenticated
with check (public.is_admin());

drop policy if exists "jenis admin update" on public.jenis_laporan;
create policy "jenis admin update"
on public.jenis_laporan for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- 2) KOLOM BARU DI LAPORAN ---------------------------------------

alter table public.laporan add column if not exists kategori text;
alter table public.laporan add column if not exists jenis_id  uuid references public.jenis_laporan(id);
alter table public.laporan add column if not exists tahap     text;
alter table public.laporan add column if not exists parent_id uuid references public.laporan(id) on delete cascade;

-- Nama constraint FK parent_id dipakai PostgREST untuk embed relasi
-- (laporan_parent_id_fkey). Pastikan namanya konsisten.
alter table public.laporan
  drop constraint if exists laporan_parent_id_fkey;
alter table public.laporan add column if not exists perihal   text;

-- Nilai default untuk baris lama + constraint.
update public.laporan set kategori = 'kegiatan' where kategori is null;
update public.laporan set tahap = 'awal'        where tahap is null;

alter table public.laporan
  alter column kategori set default 'kegiatan';
alter table public.laporan
  alter column kategori set not null;
alter table public.laporan
  alter column tahap set default 'awal';
alter table public.laporan
  alter column tahap set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'laporan_kategori_check'
  ) then
    alter table public.laporan add constraint laporan_kategori_check
      check (kategori in ('kegiatan','kejadian'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'laporan_tahap_check'
  ) then
    alter table public.laporan add constraint laporan_tahap_check
      check (tahap in ('awal','update','lengkap'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'laporan_parent_id_fkey'
  ) then
    alter table public.laporan
      add constraint laporan_parent_id_fkey
      foreign key (parent_id) references public.laporan(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_laporan_parent   on public.laporan (parent_id, timestamp_kirim);
create index if not exists idx_laporan_kategori on public.laporan (kategori, tahap, timestamp_kirim desc);
create index if not exists idx_laporan_jenis    on public.laporan (jenis_id);

-- 3) TRIGGER: turunan hanya oleh pembuat induk, kategori sama ----

create or replace function public.validate_laporan_turunan()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_parent public.laporan%rowtype;
begin
  if new.parent_id is null then
    -- Laporan awal: wajib tahap 'awal'.
    if new.tahap is distinct from 'awal' then
      raise exception 'Laporan baru harus bertahap awal';
    end if;
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

drop trigger if exists trg_laporan_turunan on public.laporan;
create trigger trg_laporan_turunan
before insert on public.laporan
for each row execute function public.validate_laporan_turunan();

-- Saat turunan dikirim, status induk mengikuti tahap terakhir agar
-- rangkaian "tertutup" setelah Laporan Lengkap (tidak bisa ditambah lagi).
create or replace function public.sync_parent_tahap()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.parent_id is not null then
    update public.laporan
       set tahap = new.tahap
     where id = new.parent_id
       and tahap is distinct from new.tahap;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_laporan_sync_parent on public.laporan;
create trigger trg_laporan_sync_parent
after insert on public.laporan
for each row execute function public.sync_parent_tahap();

-- 4) SEED MASTER JENIS --------------------------------------------
-- Kegiatan = daftar program kerja. Kejadian = daftar temuan.

insert into public.jenis_laporan (kategori, nama, urutan) values
  ('kegiatan', 'Patroli Dialogis', 1),
  ('kegiatan', 'Patroli Keliling (KRYD)', 2),
  ('kegiatan', 'Sambang / Pembinaan Bhabinkamtibmas', 3),
  ('kegiatan', 'Sosialisasi & Himbauan Kamtibmas', 4),
  ('kegiatan', 'Pengamanan Kegiatan Masyarakat', 5),
  ('kegiatan', 'Pengaturan & Penjagaan Lalu Lintas', 6),
  ('kegiatan', 'Razia / Operasi Khusus', 7),
  ('kegiatan', 'Koordinasi & Rapat Instansi', 8),
  ('kegiatan', 'Layanan Kepolisian Masyarakat', 9),
  ('kegiatan', 'Penyelidikan & Penyidikan', 10),
  ('kegiatan', 'Patroli Perairan', 11),
  ('kegiatan', 'Pengumpulan Informasi Kamtibmas', 12),
  ('kejadian', 'Kecelakaan Lalu Lintas', 1),
  ('kejadian', 'Pencurian', 2),
  ('kejadian', 'Pencurian dengan Kekerasan', 3),
  ('kejadian', 'Perampokan', 4),
  ('kejadian', 'Pencopetan', 5),
  ('kejadian', 'Penipuan', 6),
  ('kejadian', 'Penganiayaan', 7),
  ('kejadian', 'Hilangnya Nyawa', 8),
  ('kejadian', 'Kerusuhan / Unjuk Rasa', 9),
  ('kejadian', 'Kebakaran', 10),
  ('kejadian', 'Bencana Alam', 11),
  ('kejadian', 'Temuan Narkotika', 12),
  ('kejadian', 'Temuan Barang / Benda', 13),
  ('kejadian', 'Kejadian Lainnya', 14)
on conflict (kategori, nama) do nothing;

-- 5) FOLDER_LAPORAN: tambah kolom baru + child_count --------------
-- Signature (return table) berubah → fungsi lama WAJIB di-drop dulu,
-- kalau tidak PostgreSQL menolak dengan 42P13.

drop function if exists public.folder_laporan(text);

create or replace function public.folder_laporan(p_folder_key text)
returns table (
  id              uuid,
  regu_id         uuid,
  timestamp_kirim timestamptz,
  siklus_ke       int,
  latitude        double precision,
  longitude       double precision,
  status_sync     text,
  catatan         text,
  kategori        text,
  tahap           text,
  perihal         text,
  jenis_nama      text,
  parent_id       uuid,
  child_count     bigint,
  nama_regu       text,
  fotos           jsonb,
  videos          jsonb
)
language sql
stable
set search_path = public
as $$
  select
    l.id,
    l.regu_id,
    l.timestamp_kirim,
    l.siklus_ke,
    l.latitude,
    l.longitude,
    l.status_sync,
    l.catatan,
    l.kategori,
    l.tahap,
    l.perihal,
    j.nama as jenis_nama,
    l.parent_id,
    coalesce((
      select count(*) from public.laporan c where c.parent_id = l.id
    ), 0)::bigint as child_count,
    r.nama_regu,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id,
               'storage_path', f.storage_path,
               'urutan_foto', f.urutan_foto,
               'watermark_timestamp', f.watermark_timestamp,
               'watermark_lat', f.watermark_lat,
               'watermark_lng', f.watermark_lng
             ) order by f.urutan_foto)
      from public.laporan_foto f
      where f.laporan_id = l.id
    ), '[]'::jsonb) as fotos,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id,
               'storage_path', v.storage_path,
               'duration_seconds', v.duration_seconds
             ))
      from public.laporan_video v
      where v.laporan_id = l.id
    ), '[]'::jsonb) as videos
  from public.laporan l
  join public.regu r on r.id = l.regu_id
  left join public.jenis_laporan j on j.id = l.jenis_id
  where (
        (p_folder_key like 'satuan:%'
         and r.access_level = 'pelapor-level-2'
         and lower(trim(coalesce(r.unit_key, ''))) = lower(substr(p_folder_key, 8)))
     or (p_folder_key like 'unit:%'
         and r.access_level = 'pelapor-level-1'
         and lower(trim(coalesce(r.wilayah_key, ''))) = lower(split_part(substr(p_folder_key, 6), ':', 1))
         and lower(trim(coalesce(r.unit_key, '')))    = lower(split_part(substr(p_folder_key, 6), ':', 2)))
     or (p_folder_key like 'arsip:%'
         and coalesce(r.is_legacy, false)
         and lower(trim(coalesce(r.wilayah_key, ''))) = lower(substr(p_folder_key, 7))
         and coalesce(trim(r.unit_key), '') = '')
    )
    and public.can_read_laporan(r.id)
  order by l.timestamp_kirim desc
  limit 200;
$$;

revoke all on function public.folder_laporan(text) from public;
revoke all on function public.folder_laporan(text) from anon;
grant execute on function public.folder_laporan(text) to authenticated;

-- 6) REALTIME untuk jenis_laporan (opsional, agar pilihan baru
--    langsung muncul tanpa reload) ---------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jenis_laporan'
    ) then
      execute 'alter publication supabase_realtime add table public.jenis_laporan';
    end if;
  end if;
end $$;
