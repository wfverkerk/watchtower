-- Sessions now carry the live score, taken from the live scorer's snapshot (score actions per team).
-- Also stores a snapshot for the test live game so the landing shows a score.
create or replace function public.list_match_sessions(p_include_closed boolean default false)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'scheduleId', m.schedule_game_id, 'startsAt', m.session_starts_at, 'status', s.status,
    'teams', (select jsonb_agg(jsonb_build_object('id', t->'id', 'name', t->'name', 'color', t->'color') order by ordinal)
      from jsonb_array_elements(m.game_data->'teams') with ordinality as item(t, ordinal)),
    'homeScore', coalesce((select sum((a->>'value')::int) from public.match_scorer_snapshots sn
      cross join lateral jsonb_array_elements(coalesce(sn.snapshot->'actions', '[]'::jsonb)) a
      where sn.match_id = m.id and sn.tracker_id = m.live_tracker_id and a->>'type' = 'score'
        and a->>'teamId' = m.game_data->'teams'->0->>'id'), 0),
    'awayScore', coalesce((select sum((a->>'value')::int) from public.match_scorer_snapshots sn
      cross join lateral jsonb_array_elements(coalesce(sn.snapshot->'actions', '[]'::jsonb)) a
      where sn.match_id = m.id and sn.tracker_id = m.live_tracker_id and a->>'type' = 'score'
        and a->>'teamId' = m.game_data->'teams'->1->>'id'), 0),
    'canClose', auth.uid() = m.owner_id or public.session_is_coach(m.id),
    'canReview', public.session_has_right(m.id, 'finalise_review'),
    'closed', s.status not in ('open', 'live')
  ) order by m.session_starts_at), '[]'::jsonb)
  from public.shared_matches m
  cross join lateral (select public.session_status(m.id) as status) s
  where m.session_starts_at is not null
    and (p_include_closed or s.status in ('open', 'live'));
$$;

create or replace function public.refresh_test_live_snapshot()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_match uuid;
  v_owner uuid;
begin
  select id, owner_id into v_match, v_owner from public.shared_matches where schedule_game_id = 'test-game-live';
  if v_match is null then return; end if;

  insert into public.match_scorer_snapshots (match_id, tracker_id, revision, snapshot, updated_at)
  values (v_match, v_owner, 1, jsonb_build_object(
      'teams', jsonb_build_array(
        jsonb_build_object('id', 'home', 'name', 'Harlem Globetrotters', 'color', '#f26a36'),
        jsonb_build_object('id', 'away', 'name', 'Washington Generals', 'color', '#5d72d9')),
      'players', jsonb_build_array(
        jsonb_build_object('id', 'home-1', 'name', 'Test Speler 1', 'teamId', 'home', 'jerseyNumber', '4', 'isOnCourt', true),
        jsonb_build_object('id', 'home-2', 'name', 'Test Speler 2', 'teamId', 'home', 'jerseyNumber', '7', 'isOnCourt', true),
        jsonb_build_object('id', 'away-1', 'name', 'Test Speler 3', 'teamId', 'away', 'jerseyNumber', '9', 'isOnCourt', true)),
      'actions', jsonb_build_array(
        jsonb_build_object('id', 'test-live-1', 'playerId', 'home-1', 'teamId', 'home', 'type', 'score', 'value', 2, 'period', 1),
        jsonb_build_object('id', 'test-live-2', 'playerId', 'away-1', 'teamId', 'away', 'type', 'score', 'value', 2, 'period', 1),
        jsonb_build_object('id', 'test-live-3', 'playerId', 'home-2', 'teamId', 'home', 'type', 'missed_shot', 'value', 3, 'period', 1),
        jsonb_build_object('id', 'test-live-4', 'playerId', 'home-1', 'teamId', 'home', 'type', 'score', 'value', 3, 'period', 1))),
    now())
  on conflict (match_id, tracker_id) do update set
    revision = excluded.revision, snapshot = excluded.snapshot, updated_at = excluded.updated_at;
end;
$$;

select public.refresh_test_live_snapshot();

revoke all on function public.refresh_test_live_snapshot() from public, anon, authenticated;
