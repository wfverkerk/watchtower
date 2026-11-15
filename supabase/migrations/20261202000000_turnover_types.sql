-- Accepts the extended turnover types when submitting an offline match.
-- Only the turnover type check changes; the rest of submit_offline_match_unlocked stays as defined in 20261201000000_event_flow_rebounds.sql.
create or replace function public.submit_offline_match_unlocked(
  p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamptz, p_display_name text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_match public.shared_matches%rowtype;
  v_existing public.match_offline_submissions%rowtype;
  v_created jsonb;
  v_clean jsonb;
  v_action jsonb;
  v_public_action jsonb;
  v_name text := nullif(trim(p_display_name), '');
  v_home text;
  v_away text;
  v_remote_home text;
  v_remote_away text;
  v_reverse boolean;
begin
  if auth.uid() is null or p_local_id is null or p_starts_at is null then raise exception 'Missing submission identity'; end if;
  if v_name is null or length(v_name) > 60 then raise exception 'Display name must contain 1 to 60 characters'; end if;
  if jsonb_typeof(p_game_data) is distinct from 'object' or octet_length(p_game_data::text) > 1048576
    or jsonb_typeof(p_game_data->'teams') is distinct from 'array'
    or jsonb_array_length(p_game_data->'teams') <> 2
    or jsonb_typeof(p_game_data->'players') is distinct from 'array'
    or jsonb_typeof(p_game_data->'actions') is distinct from 'array' then
    raise exception 'Invalid local match';
  end if;
  if jsonb_typeof(p_game_data->'matchInfo'->'startsAt') is distinct from 'string'
    or (p_game_data->'matchInfo'->>'startsAt')::timestamptz is distinct from p_starts_at then
    raise exception 'Local match start metadata does not match';
  end if;
  v_home := lower(trim(p_game_data->'teams'->0->>'name'));
  v_away := lower(trim(p_game_data->'teams'->1->>'name'));
  if nullif(v_home, '') is null or nullif(v_away, '') is null or v_home = v_away then
    raise exception 'Two different team names are required';
  end if;
  if exists (select 1 from jsonb_array_elements(p_game_data->'actions') a
    where jsonb_typeof(a) is distinct from 'object'
      or jsonb_typeof(a->'id') is distinct from 'string'
      or jsonb_typeof(a->'teamId') is distinct from 'string'
      or a->>'teamId' not in ('home', 'away')
      or jsonb_typeof(a->'type') is distinct from 'string'
      or a->>'type' not in ('score', 'missed_shot', 'rebound', 'offensive_rebound', 'defensive_rebound', 'assist', 'turnover', 'foul', 'block', 'steal')
      or (jsonb_typeof(a->'playerId') is distinct from 'string'
        and not (jsonb_typeof(a->'playerId') is not distinct from 'null'
          and (a->>'type' = 'score' or a->>'type' in ('offensive_rebound', 'defensive_rebound'))))
      or jsonb_typeof(a->'value') is distinct from 'number'
      or abs((a->>'value')::numeric) > 1e100::numeric
      or jsonb_typeof(a->'createdAt') is distinct from 'number'
      or (a->>'createdAt')::numeric < 0 or (a->>'createdAt')::numeric > 253402300799999
      or (a ? 'groupId' and jsonb_typeof(a->'groupId') is distinct from 'string')
      or (a ? 'period' and (
        jsonb_typeof(a->'period') is distinct from 'number'
        or (a->>'period')::numeric < 1 or (a->>'period')::numeric > 9007199254740991
        or trunc((a->>'period')::numeric) <> (a->>'period')::numeric))
      or (a ? 'turnoverType' and (a->>'type' <> 'turnover'
        or jsonb_typeof(a->'turnoverType') is distinct from 'string'
        or a->>'turnoverType' not in ('turnover', 'second_dribble', 'travel', 'three_seconds', 'eight_seconds', 'five_seconds', 'backcourt_violation', 'carry', 'out_of_bounds', 'kicked_ball')))
      or (a ? 'shotLocation' and (
        jsonb_typeof(a->'shotLocation') is distinct from 'object'
        or (a->'shotLocation'->>'area' is distinct from 'own' and (
          a->'shotLocation'->>'area' is distinct from 'opponent'
          or jsonb_typeof(a->'shotLocation'->'x') is distinct from 'number'
          or jsonb_typeof(a->'shotLocation'->'y') is distinct from 'number'
          or (a->'shotLocation'->>'x')::numeric not between 0 and 100
          or (a->'shotLocation'->>'y')::numeric not between 0 and 100))))) then
    raise exception 'Invalid local match actions';
  end if;
  v_clean := public.redact_private_match_players(p_game_data);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_local_id::text, 0));
  select * into v_existing from public.match_offline_submissions where local_id = p_local_id;
  if found then
    if v_existing.user_id <> auth.uid() or (p_match_id is not null and p_match_id <> v_existing.match_id) or v_existing.game_data <> v_clean then
      raise exception 'This local match has already been submitted with different data';
    end if;
    return jsonb_build_object('match_id', v_existing.match_id);
  end if;
  if p_match_id is null then
    v_created := public.create_match_session(v_clean, v_name, p_starts_at);
    p_match_id := (v_created->>'match_id')::uuid;
  end if;
  select * into v_match from public.shared_matches where id = p_match_id for update;
  if not found or v_match.session_starts_at is null then raise exception 'Unknown session'; end if;
  v_remote_home := lower(trim(v_match.game_data->'teams'->0->>'name'));
  v_remote_away := lower(trim(v_match.game_data->'teams'->1->>'name'));
  if v_match.session_starts_at <> p_starts_at
    or not ((v_home = v_remote_home and v_away = v_remote_away) or (v_home = v_remote_away and v_away = v_remote_home))
    or (p_game_data->'matchInfo'->>'id' not like 'manual-%'
      and v_match.game_data->'matchInfo'->>'id' not like 'manual-%'
      and p_game_data->'matchInfo'->>'id' is distinct from v_match.game_data->'matchInfo'->>'id') then
    raise exception 'Local match metadata does not match the session';
  end if;
  if v_created is null and (
    exists (select 1 from public.match_events where match_id = p_match_id and tracker_id = auth.uid())
    or (v_match.owner_id = auth.uid() and jsonb_typeof(v_match.game_data->'actions') = 'array'
      and jsonb_array_length(v_match.game_data->'actions') > 0)
    or exists (select 1 from public.match_offline_submissions where match_id = p_match_id and user_id = auth.uid())
  ) then
    raise exception 'This account already has a registration in this session; submitting another could duplicate the score';
  end if;
  v_reverse := v_home = v_remote_away;
  insert into public.shared_match_members (match_id, user_id, display_name)
    values (p_match_id, auth.uid(), v_name)
    on conflict (match_id, user_id) do nothing;
  insert into public.match_offline_submissions (local_id, user_id, match_id, game_data)
    values (p_local_id, auth.uid(), p_match_id, v_clean);
  if v_created is not null then
    perform public.save_match_scorer_snapshot(p_match_id, 1, 0, jsonb_build_object(
      'teams', v_clean->'teams',
      'players', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p->'id', 'teamId', p->'teamId', 'jerseyNumber', p->'jerseyNumber',
        'isCoach', coalesce(p->'isCoach', 'false'::jsonb), 'statisticsPrivate', coalesce(p->'statisticsPrivate', 'false'::jsonb)
      )) from jsonb_array_elements(v_clean->'players') p), '[]'::jsonb),
      'actions', v_clean->'actions', 'matchDate', v_clean->'matchInfo'->'date',
      'catalogTeamId', v_clean->'catalogTeamId'
    ));
    update public.shared_matches set session_closed_at = now() where id = p_match_id;
  end if;
  for v_action in select value from jsonb_array_elements(v_clean->'actions') loop
    select jsonb_object_agg(entry.key, entry.value) into v_public_action
      from jsonb_each(v_action) entry
      where entry.key in ('id', 'playerId', 'teamId', 'type', 'value', 'createdAt',
        'groupId', 'shotLocation', 'foulType', 'turnoverType', 'period');
    if v_reverse then
      v_public_action := jsonb_set(v_public_action, '{teamId}',
        to_jsonb(case when v_action->>'teamId' = 'home' then 'away'::text else 'home'::text end));
      if v_action->>'playerId' like 'home-%' then
        v_public_action := jsonb_set(v_public_action, '{playerId}', to_jsonb('away-' || substr(v_action->>'playerId', 6)));
      elsif v_action->>'playerId' like 'away-%' then
        v_public_action := jsonb_set(v_public_action, '{playerId}', to_jsonb('home-' || substr(v_action->>'playerId', 6)));
      end if;
    end if;
    insert into public.match_events (id, match_id, tracker_id, tracker_name, action_id, event_type, action_data, occurred_at)
      values (gen_random_uuid(), p_match_id, auth.uid(), v_name, v_action->>'id', 'action_added',
        v_public_action, to_timestamp((v_action->>'createdAt')::double precision / 1000));
  end loop;
  return jsonb_build_object('match_id', p_match_id);
end;
$$;
