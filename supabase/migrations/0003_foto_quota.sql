-- =============================================================
-- SIPLAP — Migration 0003: tegakkan kuota 2 foto per regu per siklus
-- Jalankan di Supabase SQL Editor SETELAH 0001 & 0002 sukses.
-- Idempoten: aman dijalankan ulang.
--
-- Lapisan terakhir dari aturan "maksimal 2 foto per siklus per regu":
-- meski UI dibypass (device baru, script, dsb), database menolak.
-- Foto ke-3 pada siklus yang sama akan error check_violation.
-- =============================================================

create or replace function public.enforce_foto_quota_foto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regu_id uuid;
  v_siklus  int;
  v_total   int;
begin
  select regu_id, siklus_ke into v_regu_id, v_siklus
  from public.laporan where id = new.laporan_id;

  select count(*) into v_total
  from public.laporan_foto lf
  join public.laporan l on l.id = lf.laporan_id
  where l.regu_id = v_regu_id
    and l.siklus_ke = v_siklus;

  if v_total > 2 then
    raise exception 'Kuota foto terlampaui: siklus % regu ini sudah memiliki % foto (maks 2).',
      v_siklus, v_total - 1
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_foto_quota on public.laporan_foto;
create trigger trg_foto_quota
after insert on public.laporan_foto
for each row execute function public.enforce_foto_quota_foto();
