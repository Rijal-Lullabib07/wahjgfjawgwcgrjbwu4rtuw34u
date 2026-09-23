-- =============================================================
-- SIPLAP — Migration 0024: dukungan pemantau pada push_subscriptions
-- Jalankan sekali di Supabase SQL Editor (idempoten).
--
-- MASALAH YANG DIPECAHKAN
-- Klien (AdminApp) mendaftarkan push untuk akun pemantau, tetapi tabel
-- push_subscriptions versi migration lama hanya punya regu_id. Akibatnya:
--   - RPC claim_push_subscription (versi lama 0004) melempar exception
--     "akun ini tidak terhubung ke regu mana pun" → HTTP 400
--   - Fallback upsert ditolak RLS "push sub manage own" → HTTP 400
-- Device pemantau tidak pernah terdaftar → push tidak terkirim.
--
-- SOLUSI (samakan dengan db_supabase.sql):
--   1. Kolom monitor_id + index
--   2. Bersihkan baris tanpa pemilik, lalu constraint push_owner_check
--   3. Fungsi claim_push_subscription versi baru (regu ATAU pemantau)
--   4. RLS "push sub manage own" mengizinkan pemilik regu ATAU pemantau
-- =============================================================

-- 1) Kolom monitor_id -------------------------------------------------
alter table public.push_subscriptions
  add column if not exists monitor_id uuid references public.admin_users(id) on delete cascade;

create index if not exists idx_push_sub_monitor on public.push_subscriptions (monitor_id);

-- 2) Baris tanpa pemilik tidak berguna (pemilik tidak teridentifikasi);
--    hapus agar constraint di bawah tidak gagal. Device akan mendaftar ulang
--    otomatis saat app dibuka (syncPushSubscription / enablePush).
delete from public.push_subscriptions
where regu_id is null and monitor_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'push_owner_check' and conrelid = 'public.push_subscriptions'::regclass
  ) then
    alter table public.push_subscriptions
      add constraint push_owner_check check (regu_id is not null or monitor_id is not null);
  end if;
end $$;

-- 3) Fungsi claim versi baru: pelapor ATAU pemantau -------------------
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

-- 4) RLS: pemilik device = regu yang login ATAU pemantau yang login ----
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
