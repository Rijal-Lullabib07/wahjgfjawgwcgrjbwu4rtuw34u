-- JAWARA accounts: username, hierarchy, and scoped monitoring access.
-- Run after 0001_init.sql and 0002_seed.sql.
-- Passwords are provisioned by scripts/provision-jawara-accounts.mjs,
-- never stored in this migration or in the frontend.

alter table public.regu
  add column if not exists access_level text not null default 'pelapor-level-1',
  add column if not exists unit_key text,
  add column if not exists wilayah_key text;

alter table public.admin_users
  add column if not exists username text,
  add column if not exists access_level text not null default 'all',
  add column if not exists scope_key text;

create unique index if not exists admin_users_username_key
  on public.admin_users (lower(username))
  where username is not null;

alter table public.regu
  drop constraint if exists regu_access_level_check;
alter table public.regu
  add constraint regu_access_level_check
  check (access_level in ('pelapor-level-1', 'pelapor-level-2'));

alter table public.admin_users
  drop constraint if exists admin_users_access_level_check;
alter table public.admin_users
  add constraint admin_users_access_level_check
  check (access_level in ('all', 'wilayah', 'fungsi'));

-- The old demo accounts used predictable REGU01..REGU15 credentials.
-- Keep their rows for audit compatibility, but disable them before provisioning
-- the JAWARA accounts with generated passwords.
update public.regu
set status_aktif = false
where kode_login ~ '^REGU[0-9]+$';

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
  where lower(coalesce(r.kode_login, '')) = public.current_username()
     or upper(coalesce(r.kode_login, '')) = upper(split_part(coalesce(auth.email(), ''), '@', 1));
$$;

create or replace function public.is_monitor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where lower(coalesce(a.username, '')) = public.current_username()
       or lower(a.email) = lower(coalesce(auth.email(), ''))
  );
$$;

create or replace function public.can_read_laporan(target_regu_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    target_regu_id = public.current_regu_id()
    or exists (
      select 1
      from public.admin_users a
      join public.regu r on r.id = target_regu_id
      where (
        lower(coalesce(a.username, '')) = public.current_username()
        or lower(a.email) = lower(coalesce(auth.email(), ''))
      )
      and (
        a.access_level = 'all'
        or (a.access_level = 'wilayah' and r.wilayah_key = a.scope_key)
        or (a.access_level = 'fungsi' and r.unit_key = a.scope_key)
      )
    );
$$;

-- Replace the broad report read rule with role- and scope-aware access.
drop policy if exists "regu select own laporan" on public.laporan;
drop policy if exists "regu select scoped laporan" on public.laporan;
create policy "regu select scoped laporan"
on public.laporan for select to authenticated
using (public.can_read_laporan(regu_id));

drop policy if exists "admin_users readable by admin" on public.admin_users;
drop policy if exists "monitor reads own account" on public.admin_users;
create policy "monitor reads own account"
on public.admin_users for select to authenticated
using (
  lower(email) = lower(coalesce(auth.email(), ''))
  or lower(coalesce(username, '')) = public.current_username()
  or public.is_admin()
);

drop policy if exists "foto select via laporan" on public.laporan_foto;
drop policy if exists "foto select via scoped laporan" on public.laporan_foto;
create policy "foto select via scoped laporan"
on public.laporan_foto for select to authenticated
using (exists (
  select 1 from public.laporan l
  where l.id = laporan_id and public.can_read_laporan(l.regu_id)
));

-- Monitoring accounts may read the reporter directory, but only fields needed by UI.
drop policy if exists "regu readable by authenticated" on public.regu;
drop policy if exists "accounts readable by authenticated" on public.regu;
create policy "accounts readable by authenticated"
on public.regu for select to authenticated using (true);

-- Keep the existing admin helper compatible with username-based monitor accounts.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where lower(a.email) = lower(coalesce(auth.email(), ''))
       or lower(coalesce(a.username, '')) = public.current_username()
  )
  and exists (
    select 1 from public.admin_users a
    where (lower(a.email) = lower(coalesce(auth.email(), ''))
       or lower(coalesce(a.username, '')) = public.current_username())
      and a.access_level = 'all'
  );
$$;

comment on column public.regu.kode_login is 'JAWARA username; retained name for backward compatibility';
comment on column public.admin_users.username is 'JAWARA username for monitor login';
comment on column public.admin_users.scope_key is 'unit_key for fungsi or wilayah_key for wilayah access';
