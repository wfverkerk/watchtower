-- Schedule ids of games that have statistics logged (events or a scorer snapshot).
-- Returns only ids, so the public app can label history games without seeing match data.
create function public.scheduled_games_with_stats()
returns setof text language sql stable security definer set search_path = ''
as $$
  select distinct m.schedule_game_id
  from public.shared_matches m
  where m.schedule_game_id is not null
    and (
      exists (select 1 from public.match_events e where e.match_id = m.id)
      or exists (select 1 from public.match_scorer_snapshots s where s.match_id = m.id)
    );
$$;

revoke all on function public.scheduled_games_with_stats() from public;
grant execute on function public.scheduled_games_with_stats() to anon, authenticated;
