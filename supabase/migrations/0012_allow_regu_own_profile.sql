-- Pelapor harus dapat membaca profil regu miliknya setelah login.
-- Ini tidak membuka profil pelapor lain.

drop policy if exists "accounts readable by own scope" on public.regu;
create policy "accounts readable by own scope"
on public.regu for select to authenticated
using (
  id = public.current_regu_id()
  or public.can_read_monitor_scope(unit_key, wilayah_key)
);
