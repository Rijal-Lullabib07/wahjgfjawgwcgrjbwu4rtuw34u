-- =============================================================
-- SIPLAP — Supabase consolidated database script (PROJECT BARU)
-- =============================================================
-- Struktur akun JAWARA (146 total):
--   Pemantau (27)   : Kapolres, Wakapolres (read-only), Admin Utama,
--                     10 Kasat (fungsi), 14 Kapolsek (wilayah)
--   Pelapor Lv2 (9) : satu akun per satuan Polres (reskrim.polres, dst.)
--   Pelapor Lv1 (110): 96 akun unit di Polsek (reskrim.jatiluhur, dst.)
--                      + 14 SPKT (spkt.jatiluhur)
-- Akun lama (631) TIDAK dibuat di sini; skema tetap mendukung arsip
-- lewat kolom regu.is_legacy bila riwayat lama diimpor kemudian.
--
-- Fitur:
--   - Folder pemantau (folder_overview + folder_laporan + folder_reads)
--   - Web Push untuk pemantau (notify-laporan via Database Webhook)
--   - RLS scope-aware, Storage, Realtime, foto/video limit
--
-- Idempoten: aman dijalankan ulang di Supabase SQL Editor.
-- Tidak membuat password Auth — jalankan `npm run provision:jawara`.
-- =============================================================

-- 1) TABEL UTAMA -------------------------------------------------

create table if not exists public.regu (
  id           uuid primary key default gen_random_uuid(),
  nama_regu    text not null,
  kode_login   text not null unique,
  status_aktif boolean not null default true,
  access_level text not null default 'pelapor-level-1',
  unit_key     text,
  wilayah_key  text,
  is_legacy    boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint regu_access_level_check
    check (access_level in ('pelapor-level-1', 'pelapor-level-2'))
);

create table if not exists public.admin_users (
  id           uuid primary key default gen_random_uuid(),
  nama         text not null,
  email        text not null unique,
  role         text not null check (role in ('admin','pimpinan')),
  username     text,
  access_level text not null default 'all',
  scope_key    text,
  created_at   timestamptz not null default now(),
  constraint admin_users_access_level_check
    check (access_level in ('all', 'wilayah', 'fungsi'))
);

create unique index if not exists admin_users_username_key
  on public.admin_users (lower(username))
  where username is not null;

create table if not exists public.laporan (
  id              uuid primary key default gen_random_uuid(),
  regu_id         uuid not null references public.regu(id) on delete cascade,
  timestamp_kirim timestamptz not null default now(),
  siklus_ke       int  not null check (siklus_ke between 1 and 12),
  latitude        double precision,
  longitude       double precision,
  status_sync     text not null default 'pending' check (status_sync in ('pending','synced','failed')),
  catatan         text,
  created_at      timestamptz not null default now()
);

create table if not exists public.laporan_foto (
  id                  uuid primary key default gen_random_uuid(),
  laporan_id          uuid not null references public.laporan(id) on delete cascade,
  storage_path        text not null,
  watermark_lat       double precision,
  watermark_lng       double precision,
  watermark_timestamp timestamptz not null,
  urutan_foto         int  not null check (urutan_foto between 1 and 4),
  created_at          timestamptz not null default now(),
  unique (laporan_id, urutan_foto)
);

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

-- Subscription push: milik pelapor (regu_id) ATAU pemantau (monitor_id).
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  regu_id    uuid references public.regu(id) on delete cascade,
  monitor_id uuid references public.admin_users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint push_owner_check check (regu_id is not null or monitor_id is not null)
);

create table if not exists public.reminder_logs (
  regu_id        uuid not null references public.regu(id) on delete cascade,
  tanggal_siklus date not null,
  siklus_ke      int not null check (siklus_ke between 1 and 12),
  sent_at        timestamptz not null default now(),
  primary key (regu_id, tanggal_siklus, siklus_ke)
);

-- Penanda "sudah dibuka" per folder per pemantau → badge "N baru" hilang.
create table if not exists public.folder_reads (
  monitor_id uuid    not null references public.admin_users(id) on delete cascade,
  folder_key text    not null,
  read_at    timestamptz not null default now(),
  primary key (monitor_id, folder_key)
);

-- 2) INDEX -------------------------------------------------------

create index if not exists idx_laporan_regu_id      on public.laporan (regu_id);
create index if not exists idx_laporan_timestamp    on public.laporan (timestamp_kirim desc);
create index if not exists idx_laporan_siklus       on public.laporan (regu_id, siklus_ke, timestamp_kirim desc);
create index if not exists idx_laporan_foto_laporan on public.laporan_foto (laporan_id);
create index if not exists idx_laporan_video_laporan on public.laporan_video (laporan_id);
create index if not exists idx_push_sub_regu        on public.push_subscriptions (regu_id);
create index if not exists idx_push_sub_monitor     on public.push_subscriptions (monitor_id);
create index if not exists idx_reminder_logs_sent_at on public.reminder_logs (sent_at desc);

-- 3) HELPER: identitas & cakupan ----------------------------------

create or replace function public.current_username()
returns text
language sql stable security definer set search_path = public
as $$
  select lower(split_part(coalesce(auth.email(), ''), '@', 1));
$$;

create or replace function public.current_regu_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select r.id from public.regu r
  where lower(coalesce(r.kode_login, '')) = public.current_username();
$$;

create or replace function public.current_monitor_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select a.id from public.admin_users a
  where lower(coalesce(a.username, '')) = public.current_username()
     or lower(a.email) = lower(coalesce(auth.email(), ''))
  limit 1;
$$;

create or replace function public.is_monitor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_monitor_id() is not null;
$$;

-- Admin penuh (Kapolres / Admin Utama): boleh kelola.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where a.id = public.current_monitor_id()
      and a.access_level = 'all'
  );
$$;

-- Cakupan pemantau terhadap pasangan (unit_key, wilayah_key).
-- 'all'      → semua (Kapolres, Wakapolres, Admin Utama)
-- 'wilayah'  → semua regu di Polsek tersebut (Kapolsek)
-- 'fungsi'   → semua regu dengan unit_key tersebut (Kasat; juga folder
--               unit yang sama di tiap Polsek, mis. Kasat Intel)
create or replace function public.can_read_monitor_scope(
  target_unit_key text,
  target_wilayah_key text
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.id = public.current_monitor_id()
      and (
        lower(trim(coalesce(a.access_level, ''))) = 'all'
        or (
          lower(trim(a.access_level)) = 'wilayah'
          and lower(trim(coalesce(target_wilayah_key, ''))) =
              lower(trim(coalesce(a.scope_key, '')))
        )
        or (
          lower(trim(a.access_level)) = 'fungsi'
          and lower(trim(coalesce(target_unit_key, ''))) =
              lower(trim(coalesce(a.scope_key, '')))
        )
      )
  );
$$;

create or replace function public.can_read_regu(target_regu_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select target_regu_id = public.current_regu_id()
    or exists (
      select 1
      from public.regu r
      where r.id = target_regu_id
        and public.can_read_monitor_scope(r.unit_key, r.wilayah_key)
    );
$$;

create or replace function public.can_read_laporan(target_regu_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_read_regu(target_regu_id);
$$;

-- 4) STORAGE BUCKET ----------------------------------------------
-- (setelah helper karena policy memakai public.current_regu_id())

insert into storage.buckets (id, name, public) values ('laporan-foto','laporan-foto', true)
on conflict (id) do nothing;

drop policy if exists "regu upload own folder" on storage.objects;
drop policy if exists "public read foto" on storage.objects;

-- Pelapor hanya boleh upload ke folder miliknya (path: <regu_id>/...)
create policy "regu upload own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'laporan-foto'
  and (storage.foldername(name))[1]::uuid = public.current_regu_id()
);

create policy "public read foto"
on storage.objects for select to anon, authenticated
using (bucket_id = 'laporan-foto');

-- 5) RLS ---------------------------------------------------------

alter table public.regu                enable row level security;
alter table public.admin_users         enable row level security;
alter table public.laporan             enable row level security;
alter table public.laporan_foto        enable row level security;
alter table public.laporan_video       enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.reminder_logs       enable row level security;
alter table public.folder_reads        enable row level security;

-- regu: pelapor lihat profil sendiri; pemantau lihat sesuai cakupan.
drop policy if exists "accounts readable by own scope" on public.regu;
create policy "accounts readable by own scope"
on public.regu for select to authenticated
using (
  id = public.current_regu_id()
  or public.can_read_monitor_scope(unit_key, wilayah_key)
);

-- admin_users: pemantau lihat barisnya sendiri; admin penuh lihat semua.
drop policy if exists "monitor reads own account" on public.admin_users;
create policy "monitor reads own account"
on public.admin_users for select to authenticated
using (
  id = public.current_monitor_id()
  or public.is_admin()
);

-- laporan: sesuai cakupan; pelapor hanya miliknya.
drop policy if exists "regu select scoped laporan" on public.laporan;
create policy "regu select scoped laporan"
on public.laporan for select to authenticated
using (public.can_read_laporan(regu_id));

drop policy if exists "regu insert own laporan" on public.laporan;
create policy "regu insert own laporan"
on public.laporan for insert to authenticated
with check (regu_id = public.current_regu_id());

drop policy if exists "admin update laporan" on public.laporan;
create policy "admin update laporan"
on public.laporan for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- laporan_foto mengikuti laporan induk.
drop policy if exists "foto select via scoped laporan" on public.laporan_foto;
create policy "foto select via scoped laporan"
on public.laporan_foto for select to authenticated
using (exists (
  select 1 from public.laporan l
  where l.id = laporan_id and public.can_read_laporan(l.regu_id)
));

drop policy if exists "foto insert via laporan" on public.laporan_foto;
create policy "foto insert via laporan"
on public.laporan_foto for insert to authenticated
with check (
  exists (
    select 1 from public.laporan l
    where l.id = laporan_id and l.regu_id = public.current_regu_id()
  )
);

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

-- push_subscriptions: pemilik device kelola sendiri; admin baca semua.
drop policy if exists "push sub manage own" on public.push_subscriptions;
create policy "push sub manage own"
on public.push_subscriptions for all to authenticated
using (
  regu_id = public.current_regu_id()
  or monitor_id = public.current_monitor_id()
)
with check (
  regu_id = public.current_regu_id()
  or monitor_id = public.current_monitor_id()
);

drop policy if exists "push sub admin read" on public.push_subscriptions;
create policy "push sub admin read"
on public.push_subscriptions for select to authenticated
using (public.is_admin());

-- reminder_logs: hanya dibaca admin (penulisan lewat service_role).
drop policy if exists "admin read reminder logs" on public.reminder_logs;
create policy "admin read reminder logs"
on public.reminder_logs for select to authenticated
using (public.is_admin());

-- folder_reads: pemantau kelola penanda baca miliknya.
drop policy if exists "folder reads manage own" on public.folder_reads;
create policy "folder reads manage own"
on public.folder_reads for all to authenticated
using (monitor_id = public.current_monitor_id())
with check (monitor_id = public.current_monitor_id());

-- 6) MAKS 4 FOTO PER LAPORAN (di database, walau UI dibypass) ------

create or replace function public.enforce_foto_quota_foto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
begin
  select count(*) into v_total from public.laporan_foto where laporan_id = new.laporan_id;
  if v_total > 4 then
    raise exception 'Maksimal 4 foto per laporan.'
    using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_foto_quota on public.laporan_foto;
create trigger trg_foto_quota
after insert on public.laporan_foto
for each row execute function public.enforce_foto_quota_foto();

-- 7) KLAIM SUBSCRIPTION PUSH (pelapor ATAU pemantau) --------------

create or replace function public.claim_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regu    uuid := public.current_regu_id();
  v_monitor uuid := public.current_monitor_id();
begin
  if auth.uid() is null then
    raise exception 'harus login untuk mendaftarkan notifikasi';
  end if;

  if v_regu is null and v_monitor is null then
    raise exception 'akun ini tidak terhubung ke regu atau pemantau mana pun';
  end if;

  if coalesce(length(trim(p_endpoint)), 0) = 0
     or coalesce(length(trim(p_p256dh)), 0) = 0
     or coalesce(length(trim(p_auth)), 0) = 0 then
    raise exception 'data subscription tidak lengkap';
  end if;

  insert into public.push_subscriptions (regu_id, monitor_id, endpoint, p256dh, auth, user_agent)
  values (v_regu, v_monitor, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set regu_id    = excluded.regu_id,
        monitor_id = excluded.monitor_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

revoke all on function public.claim_push_subscription(text, text, text, text) from public;
revoke all on function public.claim_push_subscription(text, text, text, text) from anon;
grant execute on function public.claim_push_subscription(text, text, text, text) to authenticated;

-- 8) FOLDER PEMANTAU ---------------------------------------------
-- folder_key:
--   polsek:<wilayah>          → folder Polsek (agregat, level atas)
--   unit:<wilayah>:<unit>     → folder unit di Polsek (level 1)
--   satuan:<unit>             → folder satuan Polres (level 2)
--   arsip:<wilayah>           → arsip akun lama di Polsek tersebut
-- "N baru" = laporan dengan timestamp_kirim > read_at folder;
-- bila folder belum pernah dibuka, dihitung sejak awal hari ini (WIB).

create or replace function public.folder_overview()
returns table (
  folder_key  text,
  folder_label text,
  folder_kind  text,   -- polsek | unit | satuan | arsip
  parent_key   text,
  today_count  bigint,
  last_at      timestamptz,
  new_count    bigint,
  sort_order   int
)
language sql
stable
set search_path = public
as $$
  with me as (
    select a.id, a.access_level, a.scope_key
    from public.admin_users a
    where a.id = public.current_monitor_id()
    limit 1
  ),
  day0 as (
    select ((now() at time zone 'Asia/Jakarta')::date)::timestamp as ts
  ),
  folder_src as (
    select
      r.id as regu_id,
      case
        when r.access_level = 'pelapor-level-2'
          then 'satuan:' || lower(trim(coalesce(r.unit_key, '')))
        when coalesce(r.is_legacy, false)
             and coalesce(trim(r.unit_key), '') = ''
          then 'arsip:' || lower(trim(coalesce(r.wilayah_key, '')))
        else 'unit:' || lower(trim(coalesce(r.wilayah_key, ''))) || ':' || lower(trim(coalesce(r.unit_key, '')))
      end as folder_key
    from public.regu r
    cross join me
    where public.can_read_monitor_scope(r.unit_key, r.wilayah_key)
  ),
  report_rows as (
    select fs.folder_key, l.timestamp_kirim as ts
    from folder_src fs
    join public.laporan l on l.regu_id = fs.regu_id
  ),
  agg as (
    select folder_key,
           count(*) filter (
             where ts >= ((select ts from day0) at time zone 'Asia/Jakarta')
           ) as today_count,
           max(ts) as last_at
    from report_rows
    group by folder_key
  ),
  reads as (
    select fr.folder_key, fr.read_at
    from public.folder_reads fr
    cross join me
    where fr.monitor_id = me.id
  ),
  newcnt as (
    select rr.folder_key, count(*) as new_count
    from report_rows rr
    left join reads rd on rd.folder_key = rr.folder_key
    where rr.ts > coalesce(rd.read_at, ((select ts from day0) at time zone 'Asia/Jakarta'))
    group by rr.folder_key
  ),
  polsek_names(wilayah_key, nama) as (
    values
      ('kota','Polsek Purwakarta Kota'),
      ('plered','Polsek Plered'),
      ('jatiluhur','Polsek Jatiluhur'),
      ('bungursari','Polsek Bungursari'),
      ('campaka','Polsek Campaka'),
      ('cibatu','Polsek Cibatu'),
      ('pasawahan','Polsek Pasawahan'),
      ('darangdan','Polsek Darangdan'),
      ('wanayasa','Polsek Wanayasa'),
      ('maniis','Polsek Maniis'),
      ('sukatani','Polsek Sukatani'),
      ('sukasari','Polsek Sukasari'),
      ('kiarapedes','Polsek Kiarapedes'),
      ('bojong','Polsek Bojong')
  ),
  unit_names(unit_key, nama) as (
    values
      ('reskrim','Reskrim'),
      ('intelkam','Intelkam'),
      ('bhabinkamtibmas','Bhabinkamtibmas'),
      ('samapta','Samapta'),
      ('binmas','Binmas'),
      ('propam','Propam'),
      ('lantas','Lantas'),
      ('sium','Sium & Humas'),
      ('spkt','SPKT')
  ),
  satuan_names(unit_key, nama) as (
    values
      ('reskrim','Satreskrim'),
      ('intelkam','Satintelkam'),
      ('narkoba','Satresnarkoba'),
      ('binmas','Satbinmas'),
      ('samapta','Satsamapta'),
      ('pamobvit','Pam Obvit Samapta'),
      ('lantas','Satlantas'),
      ('polair','Satpolairud'),
      ('tahti','Sattahti')
  ),
  -- Folder satuan/unit/arsip yang relevan (sudah terfilter cakupan).
  sub_folders as (
    select distinct fs.folder_key from folder_src fs
    where fs.folder_key like 'unit:%' or fs.folder_key like 'arsip:%'
       or fs.folder_key like 'satuan:%'
  ),
  polsek_folders as (
    select distinct
      'polsek:' || case
        when sf.folder_key like 'unit:%' then split_part(substr(sf.folder_key, 6), ':', 1)
        else substr(sf.folder_key, 7)
      end as folder_key
    from sub_folders sf
    cross join me
    where me.access_level in ('all', 'wilayah')
      and (sf.folder_key like 'unit:%' or sf.folder_key like 'arsip:%')
  ),
  -- Agregat folder induk (polsek) dari folder anaknya.
  parent_agg as (
    select
      case
        when s.folder_key like 'unit:%'
          then 'polsek:' || split_part(substr(s.folder_key, 6), ':', 1)
        when s.folder_key like 'arsip:%'
          then 'polsek:' || substr(s.folder_key, 7)
      end as parent_key,
      sum(coalesce(a.today_count, 0)) as t_today,
      max(a.last_at) as t_last,
      sum(coalesce(n.new_count, 0)) as t_new
    from sub_folders s
    left join agg a on a.folder_key = s.folder_key
    left join newcnt n on n.folder_key = s.folder_key
    where s.folder_key like 'unit:%' or s.folder_key like 'arsip:%'
    group by 1
  )
  -- Folder Polsek (level atas, hanya untuk all/wilayah)
  select
    p.folder_key,
    coalesce(pn.nama, initcap(substr(p.folder_key, 8))) as folder_label,
    'polsek' as folder_kind,
    null::text as parent_key,
    coalesce(pa.t_today, 0)::bigint as today_count,
    pa.t_last as last_at,
    coalesce(pa.t_new, 0)::bigint as new_count,
    0 as sort_order
  from polsek_folders p
  cross join me
  left join polsek_names pn on pn.wilayah_key = substr(p.folder_key, 8)
  left join parent_agg pa on pa.parent_key = p.folder_key
  union all
  -- Folder unit di Polsek (level 1)
  select
    sf.folder_key,
    coalesce(un.nama, initcap(split_part(substr(sf.folder_key, 6), ':', 2)))
      || ' — ' || coalesce(pn.nama, initcap(split_part(substr(sf.folder_key, 6), ':', 1))) as folder_label,
    'unit' as folder_kind,
    'polsek:' || split_part(substr(sf.folder_key, 6), ':', 1) as parent_key,
    coalesce(a.today_count, 0)::bigint as today_count,
    a.last_at as last_at,
    coalesce(n.new_count, 0)::bigint as new_count,
    1 as sort_order
  from sub_folders sf
  cross join me
  left join agg a on a.folder_key = sf.folder_key
  left join newcnt n on n.folder_key = sf.folder_key
  left join polsek_names pn on pn.wilayah_key = split_part(substr(sf.folder_key, 6), ':', 1)
  left join unit_names un on un.unit_key = split_part(substr(sf.folder_key, 6), ':', 2)
  where sf.folder_key like 'unit:%'
  union all
  -- Folder arsip akun lama
  select
    sf.folder_key,
    'Arsip akun lama — ' || coalesce(pn.nama, initcap(substr(sf.folder_key, 7))) as folder_label,
    'arsip' as folder_kind,
    'polsek:' || substr(sf.folder_key, 7) as parent_key,
    coalesce(a.today_count, 0)::bigint as today_count,
    a.last_at as last_at,
    coalesce(n.new_count, 0)::bigint as new_count,
    2 as sort_order
  from sub_folders sf
  cross join me
  left join agg a on a.folder_key = sf.folder_key
  left join newcnt n on n.folder_key = sf.folder_key
  left join polsek_names pn on pn.wilayah_key = substr(sf.folder_key, 7)
  where sf.folder_key like 'arsip:%'
  union all
  -- Folder satuan Polres (level 2)
  select
    sf.folder_key,
    coalesce(sn.nama, initcap(substr(sf.folder_key, 8))) as folder_label,
    'satuan' as folder_kind,
    null::text as parent_key,
    coalesce(a.today_count, 0)::bigint as today_count,
    a.last_at as last_at,
    coalesce(n.new_count, 0)::bigint as new_count,
    3 as sort_order
  from sub_folders sf
  cross join me
  left join agg a on a.folder_key = sf.folder_key
  left join newcnt n on n.folder_key = sf.folder_key
  left join satuan_names sn on sn.unit_key = substr(sf.folder_key, 8)
  where sf.folder_key like 'satuan:%'
  order by sort_order, folder_label;
$$;

-- Buka isi folder: daftar laporan (beserta regu, foto, video).
-- RLS tetap berlaku (invoker rights) — pemantau hanya melihat
-- laporan dalam cakupannya walau memanggil folder_key lain.
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

-- Tandai folder sudah dibuka → badge "N baru" hilang.
create or replace function public.mark_folder_read(p_folder_key text)
returns void
language sql
set search_path = public
as $$
  insert into public.folder_reads (monitor_id, folder_key, read_at)
  select public.current_monitor_id(), p_folder_key, now()
  where public.current_monitor_id() is not null
  on conflict (monitor_id, folder_key)
  do update set read_at = now();
$$;

revoke all on function public.folder_overview() from public;
revoke all on function public.folder_overview() from anon;
grant execute on function public.folder_overview() to authenticated;

revoke all on function public.folder_laporan(text) from public;
revoke all on function public.folder_laporan(text) from anon;
grant execute on function public.folder_laporan(text) to authenticated;

revoke all on function public.mark_folder_read(text) from public;
revoke all on function public.mark_folder_read(text) from anon;
grant execute on function public.mark_folder_read(text) to authenticated;

-- 9) REALTIME ----------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'laporan'
    ) then
      execute 'alter publication supabase_realtime add table public.laporan';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'laporan_foto'
    ) then
      execute 'alter publication supabase_realtime add table public.laporan_foto';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'laporan_video'
    ) then
      execute 'alter publication supabase_realtime add table public.laporan_video';
    end if;
  end if;
end $$;

-- 10) SEED 146 AKUN JAWARA ---------------------------------------
-- Hanya metadata akun; password dibuat oleh scripts/provision-jawara-accounts.mjs.

-- 10a. Pemantau all-access (3)
insert into public.admin_users (nama, email, username, role, access_level, scope_key)
values
  ('KAPOLRES',   'polres.kapolres@monitor.siplap.id',   'polres.kapolres',   'admin',    'all', null),
  ('WAKAPOLRES', 'polres.wakapolres@monitor.siplap.id', 'polres.wakapolres', 'pimpinan', 'all', null),
  ('ADMIN UTAMA','admin@polres.go.id',                  'polres.admin',      'admin',    'all', null)
on conflict (email) do update set
  nama = excluded.nama, username = excluded.username, role = excluded.role,
  access_level = excluded.access_level, scope_key = excluded.scope_key;

-- 10b. Pemantau sesuai fungsi: 10 Kasat
insert into public.admin_users (nama, email, username, role, access_level, scope_key)
values
  ('KASAT INTELKAM',     'intelkam.kasat@monitor.siplap.id', 'intelkam.kasat', 'pimpinan', 'fungsi', 'intelkam'),
  ('KASAT RESKRIM',      'reskrim.kasat@monitor.siplap.id',  'reskrim.kasat',  'pimpinan', 'fungsi', 'reskrim'),
  ('KASAT RESNARKOBA',   'narkoba.kasat@monitor.siplap.id',  'narkoba.kasat',  'pimpinan', 'fungsi', 'narkoba'),
  ('KASAT BINMAS',       'binmas.kasat@monitor.siplap.id',   'binmas.kasat',   'pimpinan', 'fungsi', 'binmas'),
  ('KASAT SAMAPTA',      'samapta.kasat@monitor.siplap.id',  'samapta.kasat',  'pimpinan', 'fungsi', 'samapta'),
  ('PAM OBVIT SAMAPTA',  'pamobvit.kasat@monitor.siplap.id', 'pamobvit.kasat', 'pimpinan', 'fungsi', 'pamobvit'),
  ('KASAT LANTAS',       'lantas.kasat@monitor.siplap.id',   'lantas.kasat',   'pimpinan', 'fungsi', 'lantas'),
  ('KASAT POLAIR',       'polair.kasat@monitor.siplap.id',   'polair.kasat',   'pimpinan', 'fungsi', 'polair'),
  ('KASAT TAHTI',        'tahti.kasat@monitor.siplap.id',    'tahti.kasat',    'pimpinan', 'fungsi', 'tahti'),
  ('KASAT SPKT',         'spkt.kasat@monitor.siplap.id',     'spkt.kasat',     'pimpinan', 'fungsi', 'spkt')
on conflict (email) do update set
  nama = excluded.nama, username = excluded.username, role = excluded.role,
  access_level = excluded.access_level, scope_key = excluded.scope_key;

-- 10c. Pemantau sesuai wilayah: 14 Kapolsek
insert into public.admin_users (nama, email, username, role, access_level, scope_key)
select 'KAPOLSEK ' || upper(w.nama),
       w.wilayah_key || '.kapolsek@monitor.siplap.id',
       w.wilayah_key || '.kapolsek',
       'pimpinan', 'wilayah', w.wilayah_key
from (values
  ('kota','Purwakarta Kota'), ('plered','Plered'),
  ('jatiluhur','Jatiluhur'),  ('bungursari','Bungursari'),
  ('campaka','Campaka'),      ('cibatu','Cibatu'),
  ('pasawahan','Pasawahan'),  ('darangdan','Darangdan'),
  ('wanayasa','Wanayasa'),    ('maniis','Maniis'),
  ('sukatani','Sukatani'),    ('sukasari','Sukasari'),
  ('kiarapedes','Kiarapedes'),('bojong','Bojong')
) as w(wilayah_key, nama)
on conflict (email) do update set
  nama = excluded.nama, username = excluded.username, role = excluded.role,
  access_level = excluded.access_level, scope_key = excluded.scope_key;

-- 10d. Pelapor level 2: 9 akun, satu per satuan Polres
insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key)
values
  ('Satintelkam',       'intelkam.polres', true, 'pelapor-level-2', 'intelkam', null),
  ('Satreskrim',        'reskrim.polres',  true, 'pelapor-level-2', 'reskrim',  null),
  ('Satresnarkoba',     'narkoba.polres',  true, 'pelapor-level-2', 'narkoba',  null),
  ('Satbinmas',         'binmas.polres',   true, 'pelapor-level-2', 'binmas',   null),
  ('Satsamapta',        'samapta.polres',  true, 'pelapor-level-2', 'samapta',  null),
  ('Pam Obvit Samapta', 'pamobvit.polres', true, 'pelapor-level-2', 'pamobvit', null),
  ('Satlantas',         'lantas.polres',   true, 'pelapor-level-2', 'lantas',   null),
  ('Satpolairud',       'polair.polres',   true, 'pelapor-level-2', 'polair',   null),
  ('Sattahti',          'tahti.polres',    true, 'pelapor-level-2', 'tahti',    null)
on conflict (kode_login) do update set
  nama_regu = excluded.nama_regu, status_aktif = excluded.status_aktif,
  access_level = excluded.access_level, unit_key = excluded.unit_key,
  wilayah_key = excluded.wilayah_key, is_legacy = false;

-- 10e. Pelapor level 1: 96 akun unit di Polsek (reskrim.jatiluhur, dst.)
-- Presensi unit mengikuti JAWARA APP.xlsx (BKO diabaikan):
--   samapta tidak ada di Sukatani, binmas tidak ada di Plered/Darangdan/Sukasari,
--   propam tidak ada di Purwakarta Kota/Campaka/Maniis, lantas hanya di
--   Kota/Plered/Jatiluhur/Bungursari/Cibatu, sium = staf gabungan di semua Polsek.
insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key)
select
  un.nama || ' Polsek ' || w.nama,
  un.unit_key || '.' || w.wilayah_key,
  true, 'pelapor-level-1', un.unit_key, w.wilayah_key
from (values
  ('kota','Purwakarta Kota'), ('plered','Plered'),
  ('jatiluhur','Jatiluhur'),  ('bungursari','Bungursari'),
  ('campaka','Campaka'),      ('cibatu','Cibatu'),
  ('pasawahan','Pasawahan'),  ('darangdan','Darangdan'),
  ('wanayasa','Wanayasa'),    ('maniis','Maniis'),
  ('sukatani','Sukatani'),    ('sukasari','Sukasari'),
  ('kiarapedes','Kiarapedes'),('bojong','Bojong')
) as w(wilayah_key, nama)
join (values
  ('reskrim','Reskrim'),          ('intelkam','Intelkam'),
  ('bhabinkamtibmas','Bhabinkamtibmas'), ('samapta','Samapta'),
  ('binmas','Binmas'),            ('propam','Propam'),
  ('lantas','Lantas'),            ('sium','Sium & Humas')
) as un(unit_key, nama)
  on (un.unit_key, w.wilayah_key) in (
    -- samapta: semua kecuali Sukatani
    select u, wk from (values
      ('samapta','kota'),('samapta','plered'),('samapta','jatiluhur'),('samapta','bungursari'),
      ('samapta','campaka'),('samapta','cibatu'),('samapta','pasawahan'),('samapta','darangdan'),
      ('samapta','wanayasa'),('samapta','maniis'),('samapta','sukasari'),('samapta','kiarapedes'),
      ('samapta','bojong')
    ) as v(u, wk)
    union all
    -- binmas: semua kecuali Plered, Darangdan, Sukasari
    select u, wk from (values
      ('binmas','kota'),('binmas','jatiluhur'),('binmas','bungursari'),('binmas','campaka'),
      ('binmas','cibatu'),('binmas','pasawahan'),('binmas','wanayasa'),('binmas','maniis'),
      ('binmas','sukatani'),('binmas','kiarapedes'),('binmas','bojong')
    ) as v(u, wk)
    union all
    -- propam: semua kecuali Purwakarta Kota, Campaka
    select u, wk from (values
      ('propam','plered'),('propam','jatiluhur'),('propam','bungursari'),('propam','cibatu'),
      ('propam','pasawahan'),('propam','darangdan'),('propam','wanayasa'),('propam','sukatani'),
      ('propam','sukasari'),('propam','kiarapedes'),('propam','bojong')
    ) as v(u, wk)
    union all
    -- lantas: hanya di 5 Polsek
    select u, wk from (values
      ('lantas','kota'),('lantas','plered'),('lantas','jatiluhur'),
      ('lantas','bungursari'),('lantas','cibatu')
    ) as v(u, wk)
    union all
    -- reskrim, intelkam, bhabinkamtibmas, sium: semua Polsek (4 × 14 = 56)
    select un2.u, w2.wk
    from unnest(array['reskrim','intelkam','bhabinkamtibmas','sium']) as un2(u)
    cross join unnest(array['kota','plered','jatiluhur','bungursari','campaka','cibatu','pasawahan',
                           'darangdan','wanayasa','maniis','sukatani','sukasari','kiarapedes','bojong']) as w2(wk)
  )
on conflict (kode_login) do update set
  nama_regu = excluded.nama_regu, status_aktif = excluded.status_aktif,
  access_level = excluded.access_level, unit_key = excluded.unit_key,
  wilayah_key = excluded.wilayah_key, is_legacy = false;

-- 10f. Pelapor SPKT: 14 akun (spkt.<polsek>)
insert into public.regu (nama_regu, kode_login, status_aktif, access_level, unit_key, wilayah_key)
select 'SPKT Polsek ' || w.nama,
       'spkt.' || w.wilayah_key,
       true, 'pelapor-level-1', 'spkt', w.wilayah_key
from (values
  ('kota','Purwakarta Kota'), ('plered','Plered'),
  ('jatiluhur','Jatiluhur'),  ('bungursari','Bungursari'),
  ('campaka','Campaka'),      ('cibatu','Cibatu'),
  ('pasawahan','Pasawahan'),  ('darangdan','Darangdan'),
  ('wanayasa','Wanayasa'),    ('maniis','Maniis'),
  ('sukatani','Sukatani'),    ('sukasari','Sukasari'),
  ('kiarapedes','Kiarapedes'),('bojong','Bojong')
) as w(wilayah_key, nama)
on conflict (kode_login) do update set
  nama_regu = excluded.nama_regu, status_aktif = excluded.status_aktif,
  access_level = excluded.access_level, unit_key = excluded.unit_key,
  wilayah_key = excluded.wilayah_key, is_legacy = false;

-- 11) SANITY CHECK -----------------------------------------------

do $$
declare
  n_monitor int;
  n_l2 int;
  n_l1 int;
  n_spkt int;
begin
  select count(*) into n_monitor from public.admin_users;
  select count(*) into n_l2 from public.regu where access_level = 'pelapor-level-2';
  select count(*) into n_l1 from public.regu where access_level = 'pelapor-level-1' and unit_key <> 'spkt';
  select count(*) into n_spkt from public.regu where access_level = 'pelapor-level-1' and unit_key = 'spkt';
  if n_monitor <> 27 or n_l2 <> 9 or n_l1 <> 96 or n_spkt <> 14 then
    raise exception 'Seed SIPLAP tidak lengkap: % pemantau, % pelapor Polres, % pelapor unit, % SPKT',
      n_monitor, n_l2, n_l1, n_spkt;
  end if;
  raise notice 'Seed SIPLAP selesai: 27 pemantau + 9 pelapor Polres + 96 pelapor unit + 14 SPKT = 146 akun.';
end $$;

-- =============================================================
-- SELESAI. Lanjutkan dengan:
--   1. npm run provision:jawara  → buat akun Auth + password
--   2. README → setup VAPID, NOTIFY_SECRET, deploy notify-laporan,
--      dan Database Webhook pada tabel laporan.
-- =============================================================

-- =============================================================
-- 12) TRIGGER WEBHOOK PENGANTAR PUSH (pengganti Database Webhook)
-- =============================================================
-- Memanggil Edge Function `notify-laporan` setiap ada INSERT di
-- tabel laporan. Format payload sama persis dengan Database Webhook
-- Supabase ({type:"INSERT", record:{...}}), jadi function tidak perlu
-- diubah. Butuh extension pg_net (aktif default di project Supabase).
-- Catatan: NOTIFY_SECRET di bawah harus sama dengan secret Edge Function.

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_laporan_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text := '87e52634b0f8aba24dd847488716909eff135668eacee0f4';
  v_url text := 'https://icflekfhqemzjsruylnu.supabase.co/functions/v1/notify-laporan';
begin
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', v_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(new)
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_laporan on public.laporan;
create trigger trg_notify_laporan
after insert on public.laporan
for each row execute function public.notify_laporan_webhook();

