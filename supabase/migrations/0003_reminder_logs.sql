-- SIPLAP — Migration 0003: cegah reminder berulang dalam siklus yang sama
-- Jalankan sekali di Supabase SQL Editor.

create table if not exists public.reminder_logs (
  regu_id       uuid not null references public.regu(id) on delete cascade,
  tanggal_siklus date not null,
  siklus_ke     int not null check (siklus_ke between 1 and 12),
  sent_at       timestamptz not null default now(),
  primary key (regu_id, tanggal_siklus, siklus_ke)
);

create index if not exists idx_reminder_logs_sent_at
  on public.reminder_logs (sent_at desc);

alter table public.reminder_logs enable row level security;

-- Hanya Edge Function dengan service_role yang menulis log.
drop policy if exists "admin read reminder logs" on public.reminder_logs;
create policy "admin read reminder logs"
on public.reminder_logs for select to authenticated
using (public.is_admin());
