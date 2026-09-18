-- =============================================================
-- SIPLAP — Migration 0004: klaim subscription Web Push (VAPID)
-- Jalankan sekali di Supabase SQL Editor (idempoten).
--
-- MASALAH YANG DIPECAHKAN
-- `push_subscriptions.endpoint` unik per perangkat. Policy RLS
-- "push sub manage own" hanya mengizinkan regu menulis baris miliknya sendiri,
-- sehingga bila satu HP dipakai bergantian oleh dua regu, regu kedua tidak bisa
-- mengambil alih endpoint yang sudah terdaftar (upsert-nya gagal / 0 baris).
-- Reminder pun tetap terkirim atas nama regu lama.
--
-- SOLUSI
-- Fungsi SECURITY DEFINER ini menerima endpoint + kuncinya, lalu menetapkannya
-- ke regu yang sedang login. Klien memanggilnya lebih dulu, dan hanya jatuh ke
-- upsert biasa bila fungsi ini belum ada.
-- =============================================================

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
  v_regu uuid := public.current_regu_id();
begin
  if auth.uid() is null then
    raise exception 'harus login untuk mendaftarkan notifikasi';
  end if;

  -- Admin/pimpinan tidak punya regu_id → subscription dicatat tanpa regu
  -- (tidak akan pernah dikirimi reminder oleh Edge Function).
  if v_regu is null and not public.is_admin() then
    raise exception 'akun ini tidak terhubung ke regu mana pun';
  end if;

  if coalesce(length(trim(p_endpoint)), 0) = 0
     or coalesce(length(trim(p_p256dh)), 0) = 0
     or coalesce(length(trim(p_auth)), 0) = 0 then
    raise exception 'data subscription tidak lengkap';
  end if;

  insert into public.push_subscriptions (regu_id, endpoint, p256dh, auth, user_agent)
  values (v_regu, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set regu_id    = excluded.regu_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

-- Hanya user terautentikasi yang boleh memanggil; anon ditolak.
revoke all on function public.claim_push_subscription(text, text, text, text) from public;
revoke all on function public.claim_push_subscription(text, text, text, text) from anon;
grant execute on function public.claim_push_subscription(text, text, text, text) to authenticated;
