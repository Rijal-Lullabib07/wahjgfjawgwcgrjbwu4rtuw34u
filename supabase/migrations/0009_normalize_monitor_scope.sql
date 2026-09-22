-- Pastikan pencocokan scope tidak sensitif terhadap kapitalisasi atau spasi.
-- Dengan ini Kapolsek melihat seluruh regu yang memiliki wilayah_key yang sama.

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
        lower(trim(coalesce(a.username, ''))) = public.current_username()
        or lower(trim(a.email)) = lower(trim(coalesce(auth.email(), '')))
      )
      and (
        lower(trim(coalesce(a.access_level, ''))) = 'all'
        or (
          lower(trim(a.access_level)) = 'wilayah'
          and lower(trim(coalesce(r.wilayah_key, ''))) =
              lower(trim(coalesce(a.scope_key, '')))
        )
        or (
          lower(trim(a.access_level)) = 'fungsi'
          and lower(trim(coalesce(r.unit_key, ''))) =
              lower(trim(coalesce(a.scope_key, '')))
        )
      )
    );
$$;

create or replace function public.can_read_laporan(target_regu_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_read_regu(target_regu_id);
$$;
