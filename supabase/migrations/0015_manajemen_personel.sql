-- =============================================================
-- SIPLAP — Migration 0016: Manajemen personel
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- Perubahan:
--   1) `regu.jabatan` — jabatan personel dipisah dari nama.
--   2) `admin_users.status_aktif` — nonaktif tanpa hapus.
--   3) RLS: admin penuh boleh kelola regu (insert/update) dan
--      admin_users (update), plus fungsi RPC `buat_akun_personel`
--      yang membuat user auth + row regu sekaligus (security definer,
--      hanya admin penuh).
-- =============================================================

-- 1) KOLOM BARU ---------------------------------------------------

alter table public.regu add column if not exists jabatan text;

alter table public.admin_users add column if not exists status_aktif boolean;
update public.admin_users set status_aktif = true where status_aktif is null;
alter table public.admin_users
  alter column status_aktif set default true;
alter table public.admin_users
  alter column status_aktif set not null;

-- 2) RLS TAMBAHAN UNTUK MANAJEMEN PERSONEL ------------------------

-- Admin penuh boleh menambah & mengubah data regu (tanpa delete).
drop policy if exists "admin manages regu" on public.regu;
create policy "admin manages regu"
on public.regu for insert to authenticated
with check (public.is_admin());

drop policy if exists "admin updates regu" on public.regu;
create policy "admin updates regu"
on public.regu for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Admin penuh boleh mengubah data pemantau (nama/role/scope/status).
drop policy if exists "admin manages admin_users" on public.admin_users;
create policy "admin manages admin_users"
on public.admin_users for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- 3) RPC: BUAT AKUN PERSONEL (auth + regu sekaligus) ---------------
-- Dipanggil dari menu Manajemen. Hanya admin penuh. Password/PIN
-- dikembalikan SEKALI untuk ditampilkan ke admin.

create or replace function public.buat_akun_personel(
  p_nama text,
  p_jabatan text,
  p_kode_login text,
  p_pin text,
  p_unit_key text default null,
  p_wilayah_key text default null,
  p_access_level text default 'pelapor-level-1'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_auth_id uuid;
  v_regu_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Hanya admin yang bisa menambah personel';
  end if;

  p_kode_login := lower(trim(p_kode_login));
  if p_kode_login = '' then
    raise exception 'Kode login wajib diisi';
  end if;
  if length(coalesce(p_pin, '')) < 4 then
    raise exception 'PIN minimal 4 karakter';
  end if;

  -- Kode login harus unik di regu.
  if exists (
    select 1 from public.regu r where lower(r.kode_login) = p_kode_login
  ) then
    raise exception 'Kode login "%" sudah dipakai personel lain', p_kode_login;
  end if;

  select id into v_auth_id from auth.users
  where lower(email) = p_kode_login || '@regu.siplap.id'
  limit 1;

  if v_auth_id is null then
    -- Buat user auth baru (email sintetis seperti loginRegu).
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      p_kode_login || '@regu.siplap.id',
      crypt(p_pin, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', p_kode_login)
    )
    returning id into v_auth_id;
  end if;

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  )
  select
    gen_random_uuid(), v_auth_id, 'email', 'email',
    jsonb_build_object('sub', v_auth_id::text, 'email', p_kode_login || '@regu.siplap.id'),
    now(), now(), now()
  where not exists (
    select 1 from auth.identities
    where user_id = v_auth_id and provider = 'email'
  );

  insert into public.regu (
    nama_regu, jabatan, kode_login, status_aktif,
    access_level, unit_key, wilayah_key, is_legacy
  ) values (
    p_nama, nullif(trim(coalesce(p_jabatan, '')), ''),
    p_kode_login, true,
    p_access_level,
    nullif(trim(coalesce(p_unit_key, '')), ''),
    nullif(trim(coalesce(p_wilayah_key, '')), ''),
    false
  )
  returning id into v_regu_id;

  return jsonb_build_object(
    'regu_id', v_regu_id,
    'kode_login', p_kode_login,
    'pin', p_pin
  );
end;
$$;

revoke all on function public.buat_akun_personel(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.buat_akun_personel(text, text, text, text, text, text, text)
  to authenticated;

-- 4) RPC: RESET PIN PERSONEL ---------------------------------------
-- Hanya admin; mengganti password auth user milik pelapor.

create or replace function public.reset_pin_personel(
  p_kode_login text,
  p_pin_baru text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Hanya admin yang bisa reset PIN';
  end if;
  if length(coalesce(p_pin_baru, '')) < 4 then
    raise exception 'PIN minimal 4 karakter';
  end if;

  select id into v_auth_id from auth.users
  where lower(email) = lower(trim(p_kode_login)) || '@regu.siplap.id'
  limit 1;
  if v_auth_id is null then
    raise exception 'Akun auth belum ada untuk kode ini';
  end if;

  update auth.users
     set encrypted_password = crypt(p_pin_baru, gen_salt('bf')),
         updated_at = now()
   where id = v_auth_id;
end;
$$;

revoke all on function public.reset_pin_personel(text, text) from public, anon;
grant execute on function public.reset_pin_personel(text, text) to authenticated;
