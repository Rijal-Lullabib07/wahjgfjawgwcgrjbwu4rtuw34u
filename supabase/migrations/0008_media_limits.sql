-- Media limits per report: maximum 4 photos and 1 video.
-- Storage layout: <regu_id>/<laporan_id>/foto/ and /video/.

alter table public.laporan_foto
  drop constraint if exists laporan_foto_urutan_foto_check;
alter table public.laporan_foto
  add constraint laporan_foto_urutan_foto_check check (urutan_foto between 1 and 4);

create table if not exists public.laporan_video (
  id                  uuid primary key default gen_random_uuid(),
  laporan_id          uuid not null references public.laporan(id) on delete cascade,
  storage_path        text not null unique,
  watermark_lat       double precision,
  watermark_lng       double precision,
  watermark_timestamp timestamptz not null,
  duration_seconds    integer check (duration_seconds is null or duration_seconds between 1 and 60),
  created_at          timestamptz not null default now(),
  unique (laporan_id)
);

create index if not exists idx_laporan_video_laporan on public.laporan_video (laporan_id);
alter table public.laporan_video enable row level security;

drop policy if exists "video select via laporan" on public.laporan_video;
create policy "video select via laporan"
on public.laporan_video for select to authenticated
using (exists (
  select 1 from public.laporan l
  where l.id = laporan_id and public.can_read_laporan(l.regu_id)
));

drop policy if exists "video insert via laporan" on public.laporan_video;
create policy "video insert via laporan"
on public.laporan_video for insert to authenticated
with check (exists (
  select 1 from public.laporan l
  where l.id = laporan_id and l.regu_id = public.current_regu_id()
));

-- Enforce the 4-photo limit even if the client is bypassed.
create or replace function public.enforce_foto_quota_foto()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_total int;
begin
  select count(*) into v_total from public.laporan_foto where laporan_id = new.laporan_id;
  if v_total > 4 then raise exception 'Maksimal 4 foto per laporan.' using errcode = 'check_violation'; end if;
  return new;
end;
$$;
drop trigger if exists trg_foto_quota on public.laporan_foto;
create trigger trg_foto_quota after insert on public.laporan_foto
for each row execute function public.enforce_foto_quota_foto();

-- Storage remains in laporan-foto; prevent uploads outside the reporter folder.
drop policy if exists "regu upload own folder" on storage.objects;
create policy "regu upload own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'laporan-foto'
  and (storage.foldername(name))[1]::uuid = public.current_regu_id()
);
