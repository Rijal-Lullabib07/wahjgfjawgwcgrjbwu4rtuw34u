-- =============================================================
-- SIPLAP — Migration 0002: Seed akun auth 15 regu + 1 admin
-- Jalankan di Supabase SQL Editor SETELAH 0001_init.sql sukses.
-- Idempoten: aman dijalankan ulang.
--
-- Login regu di aplikasi: Kode Regu = REGU01..REGU15, PIN = password di bawah.
-- Login admin: email + password di bawah.
--
-- ⚠️ GANTI PIN/password default sebelum dipakai produksi!
-- =============================================================

-- 1) Data master regu --------------------------------------------

insert into public.regu (nama_regu, kode_login, status_aktif) values
  ('Regu 1',  'REGU01', true),
  ('Regu 2',  'REGU02', true),
  ('Regu 3',  'REGU03', true),
  ('Regu 4',  'REGU04', true),
  ('Regu 5',  'REGU05', true),
  ('Regu 6',  'REGU06', true),
  ('Regu 7',  'REGU07', true),
  ('Regu 8',  'REGU08', true),
  ('Regu 9',  'REGU09', true),
  ('Regu 10', 'REGU10', true),
  ('Regu 11', 'REGU11', true),
  ('Regu 12', 'REGU12', true),
  ('Regu 13', 'REGU13', true),
  ('Regu 14', 'REGU14', true),
  ('Regu 15', 'REGU15', true)
on conflict (kode_login) do update
  set nama_regu = excluded.nama_regu,
      status_aktif = true;

-- 2) User auth untuk tiap regu -----------------------------------
-- Email sintetis: kode_login@regu.siplap.id (dipakai RLS current_regu_id()).
-- Password/PIN awal: siplap2026 — WAJIB diganti.
--
-- Catatan: kita TIDAK memakai ON CONFLICT (email) karena unique constraint
-- kolom email di auth.users berbeda antar versi (error 42P10).
-- Pendekatan: cek dulu, lalu insert ATAU update.

do $$
declare
  r record;
  v_password text := 'siplap2026'; -- ⚠️ GANTI
  v_crypt text;
  v_email text;
  v_id uuid;
begin
  for r in
    select kode_login from public.regu where kode_login like 'REGU%' order by kode_login
  loop
    v_email := lower(r.kode_login) || '@regu.siplap.id';
    v_crypt := crypt(v_password, gen_salt('bf'));

    -- Cari user yang sudah ada
    select id into v_id from auth.users where lower(email) = v_email limit 1;

    if v_id is null then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, recovery_token,
        email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        v_email,
        v_crypt,
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('kode_regu', r.kode_login),
        now(), now(), '', '', '', ''
      )
      returning id into v_id;
    else
      update auth.users
        set encrypted_password = v_crypt,
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            updated_at = now()
        where id = v_id;
    end if;

    -- Identity row (dibutuhkan GoTrue versi baru untuk login email+password)
    if not exists (
      select 1 from auth.identities
      where provider = 'email' and user_id = v_id
    ) then
      insert into auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        v_email, -- provider_id untuk provider 'email' = email user
        v_id,
        jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
        'email',
        now(), now(), now()
      );
    end if;
  end loop;
end $$;

-- 3) User auth admin ---------------------------------------------

do $$
declare
  v_password text := 'admin2026'; -- ⚠️ GANTI
  v_crypt text;
  v_email text := 'admin@satpolpp.go.id';
  v_id uuid;
begin
  v_crypt := crypt(v_password, gen_salt('bf'));

  select id into v_id from auth.users where lower(email) = v_email limit 1;

  if v_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      v_email,
      v_crypt,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"role":"admin"}'::jsonb,
      now(), now(), '', '', '', ''
    )
    returning id into v_id;
  else
    update auth.users
      set encrypted_password = v_crypt,
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_id;
  end if;

  if not exists (
    select 1 from auth.identities
    where provider = 'email' and user_id = v_id
  ) then
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_email, -- provider_id untuk provider 'email' = email user
      v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email',
      now(), now(), now()
    );
  end if;

  -- Tabel admin_users agar RLS is_admin() mengenalinya
  insert into public.admin_users (nama, email, role)
  values ('Administrator SIPLAP', v_email, 'admin')
  on conflict (email) do nothing;
end $$;

-- 4) Sanity check -------------------------------------------------

do $$
declare
  n_regu int;
  n_auth int;
begin
  select count(*) into n_regu from public.regu;
  select count(*) into n_auth from auth.users where email like '%@regu.siplap.id';
  if n_regu < 15 then
    raise warning 'Perhatian: hanya % regu di tabel regu (harusnya 15)', n_regu;
  end if;
  if n_auth < 15 then
    raise warning 'Perhatian: hanya % user auth regu (harusnya 15)', n_auth;
  end if;
  raise notice 'Seed selesai: % regu, % user auth regu.', n_regu, n_auth;
end $$;
