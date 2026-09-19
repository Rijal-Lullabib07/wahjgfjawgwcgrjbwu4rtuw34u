-- Hindari evaluasi policy regu secara berulang saat fungsi scope membaca regu.
-- Fungsi ini hanya membaca akun pemantau; kolom scope dari baris regu
-- diberikan sebagai argumen oleh policy.

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
    where (
      lower(trim(coalesce(a.username, ''))) = public.current_username()
      or lower(trim(a.email)) = lower(trim(coalesce(auth.email(), '')))
    )
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

drop policy if exists "accounts readable by own scope" on public.regu;
create policy "accounts readable by own scope"
on public.regu for select to authenticated
using (
  public.can_read_monitor_scope(unit_key, wilayah_key)
);
