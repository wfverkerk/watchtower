-- Test games: one upcoming game (tomorrow) and one live game that already has events.
-- Replaces the earlier test games and refresh_test_schedule(). Run select public.refresh_test_games();
-- before testing. The live session is owned by the first platform admin (or the oldest account).
drop function if exists public.refresh_test_schedule();

delete from public.zoebas_schedule where id in ('test-game-1', 'test-game-2');

create function public.refresh_test_games()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_live_start timestamptz := now() - interval '10 minutes';
  v_live_local timestamp := (now() - interval '10 minutes') at time zone 'Europe/Amsterdam';
  v_match uuid;
  v_start_ms bigint := (extract(epoch from (now() - interval '10 minutes')) * 1000)::bigint;
begin
  select user_id into v_owner from public.platform_admins order by user_id limit 1;
  if v_owner is null then
    select id into v_owner from auth.users order by created_at limit 1;
  end if;
  if v_owner is null then raise exception 'Create an account first: the test live session needs an owner'; end if;

  insert into public.zoebas_schedule (id, kind, match_date, start_time, home_team, away_team, status, venue)
  values
    ('test-game-upcoming', 'program', ((now() at time zone 'Europe/Amsterdam') + interval '1 day')::date, time '18:00',
      'Harlem Globetrotters', 'Washington Generals', 'Scheduled', 'Testhal'),
    ('test-game-live', 'program', v_live_local::date, v_live_local::time,
      'Harlem Globetrotters', 'Washington Generals', 'Scheduled', 'Testhal')
  on conflict (id) do update set
    kind = excluded.kind, match_date = excluded.match_date, start_time = excluded.start_time,
    home_team = excluded.home_team, away_team = excluded.away_team, status = excluded.status, venue = excluded.venue;

  select id into v_match from public.shared_matches where schedule_game_id = 'test-game-live';
  if v_match is null then
    insert into public.shared_matches (join_code, owner_id, game_data, schedule_game_id)
    values (upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), v_owner, '{}'::jsonb, 'test-game-live')
    returning id into v_match;
  end if;

  update public.shared_matches set
    session_starts_at = v_live_start,
    session_closed_at = null,
    session_close_requested_at = null,
    review_status = null,
    game_data = jsonb_build_object(
      'teams', jsonb_build_array(
        jsonb_build_object('id', 'home', 'name', 'Harlem Globetrotters', 'color', '#f26a36'),
        jsonb_build_object('id', 'away', 'name', 'Washington Generals', 'color', '#5d72d9')),
      'players', jsonb_build_array(
        jsonb_build_object('id', 'home-1', 'name', 'Test Speler 1', 'teamId', 'home', 'jerseyNumber', '4', 'isOnCourt', true),
        jsonb_build_object('id', 'home-2', 'name', 'Test Speler 2', 'teamId', 'home', 'jerseyNumber', '7', 'isOnCourt', true),
        jsonb_build_object('id', 'away-1', 'name', 'Test Speler 3', 'teamId', 'away', 'jerseyNumber', '9', 'isOnCourt', true)),
      'actions', '[]'::jsonb,
      'gameStarted', true,
      'period', 1,
      'matchInfo', jsonb_build_object('id', 'test-game-live', 'date', v_live_local::date::text,
        'startTime', to_char(v_live_local, 'HH24:MI'), 'venue', 'Testhal', 'startsAt', to_jsonb(v_live_start)))
  where id = v_match;

  insert into public.shared_match_members (match_id, user_id, display_name)
    values (v_match, v_owner, 'Testouder')
    on conflict (match_id, user_id) do update set display_name = excluded.display_name;

  update public.shared_matches set live_tracker_id = v_owner where id = v_match;

  delete from public.match_events where match_id = v_match;
  insert into public.match_events (id, match_id, tracker_id, tracker_name, action_id, event_type, action_data, occurred_at)
  values
    (gen_random_uuid(), v_match, v_owner, 'Testouder', 'test-live-1', 'action_added',
      jsonb_build_object('id', 'test-live-1', 'playerId', 'home-1', 'teamId', 'home', 'type', 'score', 'value', 2, 'createdAt', v_start_ms + 1000, 'period', 1), now()),
    (gen_random_uuid(), v_match, v_owner, 'Testouder', 'test-live-2', 'action_added',
      jsonb_build_object('id', 'test-live-2', 'playerId', 'away-1', 'teamId', 'away', 'type', 'score', 'value', 2, 'createdAt', v_start_ms + 2000, 'period', 1), now()),
    (gen_random_uuid(), v_match, v_owner, 'Testouder', 'test-live-3', 'action_added',
      jsonb_build_object('id', 'test-live-3', 'playerId', 'home-2', 'teamId', 'home', 'type', 'missed_shot', 'value', 3, 'createdAt', v_start_ms + 3000, 'period', 1), now()),
    (gen_random_uuid(), v_match, v_owner, 'Testouder', 'test-live-4', 'action_added',
      jsonb_build_object('id', 'test-live-4', 'playerId', 'home-1', 'teamId', 'home', 'type', 'score', 'value', 3, 'createdAt', v_start_ms + 4000, 'period', 1), now());
end;
$$;

revoke all on function public.refresh_test_games() from public, anon, authenticated;
