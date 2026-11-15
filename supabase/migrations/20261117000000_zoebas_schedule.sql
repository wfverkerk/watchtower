create table if not exists public.zoebas_schedule (
  id text primary key,
  kind text not null check (kind in ('program', 'result')),
  match_date date not null,
  start_time time not null,
  home_team text not null check (length(home_team) between 1 and 60),
  away_team text not null check (length(away_team) between 1 and 60),
  home_score integer,
  away_score integer,
  status text not null default '',
  venue text not null default '',
  synced_at timestamptz not null default now()
);

create index if not exists zoebas_schedule_date_idx on public.zoebas_schedule (match_date, start_time);

alter table public.zoebas_schedule enable row level security;

drop policy if exists "Anyone can read the Zoebas schedule" on public.zoebas_schedule;
create policy "Anyone can read the Zoebas schedule"
  on public.zoebas_schedule for select to anon, authenticated
  using (true);

grant select on public.zoebas_schedule to anon, authenticated;

-- Fictional test games. Written by the sync function only via the service role.
insert into public.zoebas_schedule (id, kind, match_date, start_time, home_team, away_team, status)
values
  ('test-game-1', 'program', (now() at time zone 'Europe/Amsterdam')::date,
    ((now() at time zone 'Europe/Amsterdam') - interval '30 minutes')::time,
    'Harlem Globetrotters', 'Washington Generals', 'Scheduled'),
  ('test-game-2', 'program', (now() at time zone 'Europe/Amsterdam')::date,
    ((now() at time zone 'Europe/Amsterdam') + interval '10 minutes')::time,
    'Washington Generals', 'Harlem Globetrotters', 'Scheduled')
on conflict (id) do nothing;

-- Moves the two test games back to "now" so they stay joinable while testing.
create function public.refresh_test_schedule()
returns void language sql security definer set search_path = ''
as $$
  update public.zoebas_schedule set
    match_date = (now() at time zone 'Europe/Amsterdam')::date,
    start_time = case when id = 'test-game-1'
      then ((now() at time zone 'Europe/Amsterdam') - interval '30 minutes')::time
      else ((now() at time zone 'Europe/Amsterdam') + interval '10 minutes')::time end
  where id in ('test-game-1', 'test-game-2');
$$;

revoke all on function public.refresh_test_schedule() from public, anon, authenticated;
