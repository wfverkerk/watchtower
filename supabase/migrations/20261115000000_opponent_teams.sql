create table public.opponent_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  logo_file text check (logo_file is null or length(logo_file) between 1 and 300)
);

create unique index opponent_teams_name_key on public.opponent_teams (lower(btrim(name)));

alter table public.opponent_teams enable row level security;
create policy "Anyone can read opponent teams" on public.opponent_teams for select to anon, authenticated using (true);
revoke all on public.opponent_teams from public, anon, authenticated;
grant select on public.opponent_teams to anon, authenticated;

-- Seed uit de logobestanden in de bucket "logos": de bestandsnaam (zonder extensie) is de teamnaam in hoofdletters.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $seed$
      insert into public.opponent_teams (name, logo_file)
      select distinct on (lower(btrim(base))) initcap(lower(btrim(base))), file
      from (
        select o.name as file, regexp_replace(o.name, '\.(gif|png|jpe?g|webp)$', '', 'i') as base
        from storage.objects o
        where o.bucket_id = 'logos' and o.name !~ '/' and o.name ~* '\.(gif|png|jpe?g|webp)$'
      ) logos
      where length(btrim(base)) between 1 and 60
      order by lower(btrim(base)), file
      on conflict do nothing
    $seed$;
  end if;
end
$$;
