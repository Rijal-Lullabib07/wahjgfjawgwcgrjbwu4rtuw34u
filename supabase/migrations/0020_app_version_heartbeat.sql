-- =============================================================
-- SIPLAP — Migration 0020: Pelaporan versi app (heartbeat)
-- IDEMPOTEN: aman dijalankan ulang di Supabase SQL Editor.
--
-- Tujuan: admin bisa melihat personel mana yang app-nya belum
-- di-update ke versi terbaru.
--
-- Cara kerja:
--   - App pelapor mengirim `app_version` (tanda waktu build, dari
--     __BUILD_TIME__) + `versi_dikirim_pada` tiap app dibuka,
--     kembali ke foreground, dan tiap kirim posisi (60 dtk).
--   - Dashboard Manajemen Personel membandingkan dengan versi
--     build TERBARU yang pernah dilaporkan: badge "Versi lama"
--     untuk yang berbeda, "Terbaru" untuk yang sama.
-- =============================================================

-- 1) KOLOM BARU ---------------------------------------------------

alter table public.regu add column if not exists app_version text;
alter table public.regu add column if not exists versi_dikirim_pada timestamptz;

comment on column public.regu.app_version is
  'Versi build app pelapor yang terakhir dilaporkan (heartbeat), mis. "2026-09-22 09:15 UTC".';
comment on column public.regu.versi_dikirim_pada is
  'Waktu server heartbeat versi terakhir diterima — untuk tahu app masih dipakai.';

-- 2) RLS ----------------------------------------------------------
-- Kolom baru mengikuti kebijakan RLS tabel regu yang sudah ada:
--   - update milik sendiri sudah diizinkan migration 0013
--     ("regu own profile" / "allow regu own profile").
--   - admin membaca seluruh regu lewat can_read_monitor_scope.
-- Tidak ada policy baru yang diperlukan; kolom hanya ikut select/update.

-- 3) PASTIKAN POLICY UPDATE MILIK SENDIRI ADA ----------------------
-- Idempoten: buat ulang bila belum ada (nama policy bisa berbeda
-- antar environment — cek dari information_schema lalu buat bila kosong).

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'regu'
      and cmd = 'UPDATE'
      and qual like '%current_regu_id%'
  ) then
    execute $policy$
      create policy "regu update own heartbeat"
      on public.regu for update to authenticated
      using (id = public.current_regu_id())
      with check (id = public.current_regu_id())
    $policy$;
  end if;
end $$;
