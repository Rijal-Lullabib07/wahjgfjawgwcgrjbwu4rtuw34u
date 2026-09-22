-- Keep monitoring realtime when video metadata is inserted after the report row.
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.laporan_video;
  end if;
exception
  when duplicate_object then null;
end
$$;
