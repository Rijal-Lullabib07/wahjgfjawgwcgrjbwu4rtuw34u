-- Batasi daftar satuan sesuai cakupan akun pemantau.
-- Kapolres, Wakapolres, dan Admin Utama tetap memakai access_level = 'all'.

create or replace function public.can_read_regu(target_regu_id uuid)
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

drop policy if exists "accounts readable by authenticated" on public.regu;
drop policy if exists "regu readable by authenticated" on public.regu;
create policy "accounts readable by own scope"
on public.regu for select to authenticated
using (public.can_read_regu(id));
