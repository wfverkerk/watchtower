-- A finished test game for the history: yesterday's result with a full scorer snapshot.
-- Linked to the statistics team x12-1 so coaches of that team see it in the statistics history.
create function public.refresh_test_history()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_start timestamptz := ((now() at time zone 'Europe/Amsterdam')::date - 1 + time '19:00') at time zone 'Europe/Amsterdam';
  v_match uuid;
  v_actions jsonb;
  v_game jsonb;
begin
  -- Test data only: the finished session is written without the live-session lock.
  perform set_config('watchtower.bypass_session_lock', 'on', true);
  select user_id into v_owner from public.platform_admins order by user_id limit 1;
  if v_owner is null then
    select id into v_owner from auth.users order by created_at limit 1;
  end if;
  if v_owner is null then raise exception 'Create an account first: the test history game needs an owner'; end if;

  insert into public.zoebas_schedule (id, kind, match_date, start_time, home_team, away_team, home_score, away_score, status, venue)
  values ('test-game-history', 'result', v_start::date, v_start::time,
    'Harlem Globetrotters', 'Washington Generals', 64, 58, 'Finished', 'Testhal')
  on conflict (id) do update set
    kind = excluded.kind, match_date = excluded.match_date, start_time = excluded.start_time,
    home_team = excluded.home_team, away_team = excluded.away_team,
    home_score = excluded.home_score, away_score = excluded.away_score, status = excluded.status;

  select id into v_match from public.shared_matches where schedule_game_id = 'test-game-history';
  if v_match is null then
    insert into public.shared_matches (join_code, owner_id, game_data, schedule_game_id)
    values (upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), v_owner, '{}'::jsonb, 'test-game-history')
    returning id into v_match;
  end if;

  insert into public.shared_match_members (match_id, user_id, display_name)
    values (v_match, v_owner, 'Testouder')
    on conflict (match_id, user_id) do update set display_name = excluded.display_name;

  -- Groups of identical actions: home 64 points, away 58 points.
  with groups(idx, team, player, type, value, cnt, period) as (values
    (1, 'home', 'h1', 'score', 2, 12, 1), (2, 'home', 'h2', 'score', 3, 6, 1), (3, 'home', 'h3', 'score', 1, 14, 1),
    (4, 'home', 'h2', 'score', 2, 4, 2), (5, 'away', 'a1', 'score', 2, 14, 1), (6, 'away', 'a2', 'score', 3, 6, 1),
    (7, 'away', 'a2', 'score', 1, 12, 1), (8, 'home', 'h2', 'assist', 1, 5, 1), (9, 'away', 'a1', 'assist', 1, 4, 1),
    (10, 'home', 'h1', 'offensive_rebound', 1, 4, 1), (11, 'home', 'h3', 'defensive_rebound', 1, 9, 1),
    (12, 'away', 'a1', 'offensive_rebound', 1, 3, 1), (13, 'away', 'a2', 'defensive_rebound', 1, 8, 1),
    (14, 'home', 'h1', 'foul', 1, 3, 1), (15, 'away', 'a2', 'foul', 1, 4, 1),
    (16, 'home', 'h2', 'turnover', 1, 5, 2), (17, 'away', 'a1', 'turnover', 1, 6, 2),
    (18, 'home', 'h3', 'steal', 1, 2, 2), (19, 'away', 'a2', 'block', 1, 2, 2),
    (20, 'home', 'h1', 'missed_shot', 2, 6, 2), (21, 'away', 'a1', 'missed_shot', 2, 5, 2))
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', 'hist-' || g.idx || '-' || n, 'type', g.type, 'value', g.value,
      'playerId', case when g.team = 'home' then 'home-' || substr(g.player, 2) else 'away-' || substr(g.player, 2) end,
      'teamId', g.team, 'period', g.period,
      'createdAt', (extract(epoch from v_start) * 1000)::bigint + g.idx * 100000 + n * 1000
    ) order by g.idx, n), '[]'::jsonb)
  into v_actions
  from groups g cross join lateral generate_series(1, g.cnt) n;

  v_game := jsonb_build_object(
    'teams', jsonb_build_array(
      jsonb_build_object('id', 'home', 'name', 'Harlem Globetrotters', 'color', '#f26a36'),
      jsonb_build_object('id', 'away', 'name', 'Washington Generals', 'color', '#5d72d9')),
    'players', jsonb_build_array(
      jsonb_build_object('id', 'home-1', 'name', 'Test Speler 1', 'teamId', 'home', 'jerseyNumber', '4', 'isCoach', false, 'statisticsPrivate', false),
      jsonb_build_object('id', 'home-2', 'name', 'Test Speler 2', 'teamId', 'home', 'jerseyNumber', '7', 'isCoach', false, 'statisticsPrivate', false),
      jsonb_build_object('id', 'home-3', 'name', 'Test Speler 3', 'teamId', 'home', 'jerseyNumber', '11', 'isCoach', false, 'statisticsPrivate', false),
      jsonb_build_object('id', 'away-1', 'name', 'Test Speler 4', 'teamId', 'away', 'jerseyNumber', '9', 'isCoach', false, 'statisticsPrivate', false),
      jsonb_build_object('id', 'away-2', 'name', 'Test Speler 5', 'teamId', 'away', 'jerseyNumber', '14', 'isCoach', false, 'statisticsPrivate', false)),
    'actions', v_actions,
    'matchDate', v_start::date::text,
    'catalogTeamId', 'x12-1');

  -- Snapshot of the official scorer, the same shape the app saves during a game.
  insert into public.match_scorer_snapshots (match_id, tracker_id, revision, snapshot, updated_at)
    values (v_match, v_owner, 1, v_game, now())
    on conflict (match_id, tracker_id) do update set revision = excluded.revision, snapshot = excluded.snapshot, updated_at = now();

  update public.shared_matches set
    session_starts_at = v_start,
    finished_at = v_start + interval '2 hours',
    official_tracker_id = v_owner,
    live_tracker_id = v_owner,
    game_data = v_game || jsonb_build_object('matchInfo', jsonb_build_object('id', 'test-game-history',
      'date', v_start::date::text, 'startTime', '19:00', 'venue', 'Testhal', 'startsAt', to_jsonb(v_start)))
  where id = v_match;

  insert into public.statistics_matches (team_id, match_id) values ('x12-1', v_match)
    on conflict do nothing;
end;
$$;

revoke all on function public.refresh_test_history() from public, anon, authenticated;
