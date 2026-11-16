-- Baseline: the schema of all migrations up to 20261204, without test data or test-only functions.
-- For a new Supabase project run this file first, then the newer migrations in order.
-- Existing projects that already ran the older migrations do not need to run this file.

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET check_function_bodies = false;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: admin_dashboard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_dashboard() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'name', z.name,
      'coaches', coalesce((
        select jsonb_agg(jsonb_build_object('userId', sc.user_id, 'email', u.email, 'rights', sc.rights) order by u.email)
        from public.statistics_coaches sc join auth.users u on u.id = sc.user_id
        where sc.team_id = t.id
      ), '[]'::jsonb)
    ) order by z.sort_order)
    from public.statistics_teams t join public.zoebas_teams z on z.id = t.id
  ), '[]'::jsonb);
end;
$$;


--
-- Name: assert_match_scorer(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assert_match_scorer(p_match_id uuid, p_tracker_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_scorer uuid;
begin
  select scorer_id into v_scorer from public.shared_matches where id = p_match_id;
  if v_scorer is not null and v_scorer is distinct from p_tracker_id then
    raise exception 'not_scorer: only the scorer of this match can register actions';
  end if;
end;
$$;


--
-- Name: close_match_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_match_session(p_match_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_match public.shared_matches%rowtype;
begin
  select * into v_match from public.shared_matches where id = p_match_id for update;
  if not found or v_match.session_starts_at is null then raise exception 'Unknown session'; end if;
  if auth.uid() is null or (auth.uid() <> v_match.owner_id
    and not public.statistics_is_coach(v_match.game_data->>'catalogTeamId')) then
    raise exception 'Only the creator or a team coach can close the session';
  end if;
  update public.shared_matches
    set session_close_requested_at = coalesce(session_close_requested_at, now())
    where id = p_match_id;
end;
$$;


--
-- Name: create_match_session(jsonb, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_match_session(p_game_data jsonb, p_display_name text, p_starts_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_result jsonb;
begin
  if p_starts_at is null then raise exception 'A start time is required'; end if;
  if jsonb_typeof(p_game_data->'matchInfo'->'startsAt') is distinct from 'string'
    or (p_game_data->'matchInfo'->>'startsAt')::timestamptz is distinct from p_starts_at then
    raise exception 'Match start metadata is required';
  end if;
  if jsonb_typeof(p_game_data->'teams') is distinct from 'array'
     or jsonb_array_length(p_game_data->'teams') <> 2
     or exists (select 1 from jsonb_array_elements(p_game_data->'teams') t
       where nullif(trim(t->>'name'), '') is null or jsonb_typeof(t->'id') is distinct from 'string'
         or jsonb_typeof(t->'color') is distinct from 'string') then
    raise exception 'Two team names are required';
  end if;
  v_result := public.create_shared_match(p_game_data, p_display_name);
  update public.shared_matches set session_starts_at = p_starts_at, live_tracker_id = auth.uid()
    where id = (v_result->>'match_id')::uuid;
  return v_result;
end;
$$;


--
-- Name: create_shared_match(jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_shared_match(p_game_data jsonb, p_display_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  created_match_id uuid;
  new_join_code text;
  clean_display_name text := nullif(trim(p_display_name), '');
  clean_game jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in anonymously before creating a match.'; end if;
  if clean_display_name is null or length(clean_display_name) > 60 then
    raise exception 'Display name must contain 1 to 60 characters.';
  end if;
  if p_game_data is null or jsonb_typeof(p_game_data) <> 'object' then
    raise exception 'Match data must be a JSON object.';
  end if;
  clean_game := public.redact_private_match_players(p_game_data);
  loop
    new_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.shared_matches (join_code, owner_id, game_data)
    values (new_join_code, auth.uid(), clean_game)
    on conflict (join_code) do nothing returning id into created_match_id;
    exit when created_match_id is not null;
  end loop;
  insert into public.shared_match_members (match_id, user_id, display_name)
  values (created_match_id, auth.uid(), clean_display_name);
  return jsonb_build_object('match_id', created_match_id, 'join_code', new_join_code, 'game_data', clean_game);
end;
$$;


--
-- Name: create_statistics_team(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_statistics_team() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.statistics_teams (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;


--
-- Name: is_platform_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;


--
-- Name: join_match_session(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_match_session(p_match_id uuid, p_display_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_match public.shared_matches%rowtype;
  v_name text := nullif(trim(p_display_name), '');
begin
  if auth.uid() is null then raise exception 'Sign in before joining a match'; end if;
  if v_name is null or length(v_name) > 60 then raise exception 'Display name must contain 1 to 60 characters'; end if;
  select * into v_match from public.shared_matches where id = p_match_id for update;
  if not found or v_match.session_starts_at is null then raise exception 'Unknown session'; end if;
  if now() < v_match.session_starts_at - interval '15 minutes' then raise exception 'Session has not opened yet'; end if;
  if public.session_status(v_match.id) not in ('open', 'live') then raise exception 'Session is closed'; end if;
  insert into public.shared_match_members (match_id, user_id, display_name)
    values (v_match.id, auth.uid(), v_name)
    on conflict (match_id, user_id) do update set display_name = excluded.display_name;
  return jsonb_build_object('match_id', v_match.id, 'join_code', v_match.join_code, 'game_data', v_match.game_data);
end;
$$;


--
-- Name: join_shared_match(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_shared_match(p_join_code text, p_display_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_match public.shared_matches%rowtype;
  v_name text := nullif(trim(p_display_name), '');
begin
  if auth.uid() is null then raise exception 'Sign in before joining a match'; end if;
  if v_name is null or length(v_name) > 60 then raise exception 'Display name must contain 1 to 60 characters'; end if;
  select * into v_match from public.shared_matches where join_code = upper(trim(p_join_code)) for update;
  if not found then raise exception 'No match was found for that code'; end if;
  if v_match.session_starts_at is not null then
    return public.join_match_session(v_match.id, v_name);
  end if;
  insert into public.shared_match_members (match_id, user_id, display_name)
    values (v_match.id, auth.uid(), v_name)
    on conflict (match_id, user_id) do update set display_name = excluded.display_name;
  return jsonb_build_object('match_id', v_match.id, 'join_code', v_match.join_code, 'game_data', v_match.game_data);
end;
$$;


--
-- Name: list_match_sessions(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_match_sessions(p_include_closed boolean DEFAULT false) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: match_can_take_over(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_can_take_over(p_match_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v public.shared_matches%rowtype;
  v_status text;
begin
  if auth.uid() is null then return false; end if;
  select * into v from public.shared_matches where id = p_match_id;
  if not found then return false; end if;
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    return false;
  end if;
  if coalesce(v.scorer_id, v.live_tracker_id, v.owner_id) = auth.uid() then return false; end if;
  v_status := public.session_status(p_match_id);
  if v_status is null or v_status in ('open', 'live') then return v.finished_at is null; end if;
  return v_status = 'in_review' and public.session_is_coach(p_match_id);
end;
$$;


--
-- Name: match_events_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_events_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_status text := public.session_status(new.match_id);
begin
  perform public.assert_match_scorer(new.match_id, new.tracker_id);
  if v_status is null or v_status in ('open', 'live') then return new; end if;
  perform public.session_guard_write(new.match_id);
  new.counts_as_activity := false;
  return new;
end;
$$;


--
-- Name: match_scorers(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_scorers(p_match_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  return (
    select jsonb_build_object(
      'finishedAt', m.finished_at, 'officialTrackerId', m.official_tracker_id,
      'liveTrackerId', m.live_tracker_id,
      'canManageLive', m.session_starts_at is not null and m.scorer_id is null and
        (auth.uid() = m.owner_id or public.statistics_is_coach(m.game_data->>'catalogTeamId')),
      'scorerId', m.scorer_id,
      'scorerName', (select member.display_name from public.shared_match_members member
        where member.match_id = m.id and member.user_id = m.scorer_id),
      'scorerSince', m.scorer_since,
      'lastEventAt', (select max(event.received_at) from public.match_events event
        where event.match_id = m.id and event.tracker_id = m.scorer_id),
      'canTakeOver', public.match_can_take_over(m.id),
      'scorers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', member.user_id, 'name', member.display_name, 'updatedAt', snapshot.updated_at
      ) order by member.joined_at)
      from public.shared_match_members member
      left join public.match_scorer_snapshots snapshot on snapshot.match_id = member.match_id and snapshot.tracker_id = member.user_id
      where member.match_id = m.id), '[]'::jsonb)
    ) from public.shared_matches m where m.id = p_match_id
  );
end;
$$;


--
-- Name: match_select_official_scorer(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_select_official_scorer(p_match_id uuid, p_tracker_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_scorer uuid;
begin
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  select scorer_id into v_scorer from public.shared_matches where id = p_match_id for update;
  if not found then raise exception 'Unknown match'; end if;
  if v_scorer is not null and v_scorer <> p_tracker_id then
    raise exception 'Only the scorer of this match can be the official scorer';
  end if;
  if not exists (select 1 from public.match_scorer_snapshots where match_id = p_match_id and tracker_id = p_tracker_id) then
    raise exception 'Selected scorer has not synchronized a snapshot';
  end if;
  if exists (select 1 from public.statistics_matches m join public.match_scorer_snapshots s
    on s.match_id = m.match_id and s.tracker_id = p_tracker_id
    where m.match_id = p_match_id and s.snapshot->>'catalogTeamId' is not null
      and s.snapshot->>'catalogTeamId' <> m.team_id) then
    raise exception 'The selected scorer recorded a different team';
  end if;
  update public.shared_matches set official_tracker_id = p_tracker_id
    where id = p_match_id and finished_at is not null;
  if not found then raise exception 'Match has not been finished'; end if;
end;
$$;


--
-- Name: match_snapshot_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_snapshot_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform public.assert_match_scorer(new.match_id, new.tracker_id);
  perform public.session_guard_write(new.match_id);
  return new;
end;
$$;


--
-- Name: my_match_snapshot(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_match_snapshot(p_match_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object('revision', revision, 'snapshot', snapshot)
  from public.match_scorer_snapshots
  where match_id = p_match_id and tracker_id = auth.uid()
$$;


--
-- Name: open_schedule_session(text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_schedule_session(p_schedule_id text, p_game_data jsonb, p_display_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  s public.zoebas_schedule%rowtype;
  v_starts timestamptz;
  v_existing uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in before opening a session'; end if;
  select * into s from public.zoebas_schedule where id = p_schedule_id and kind = 'program';
  if not found then raise exception 'Unknown scheduled game'; end if;
  v_starts := (s.match_date + s.start_time) at time zone 'Europe/Amsterdam';
  if now() < v_starts - interval '15 minutes' then raise exception 'Session has not opened yet'; end if;
  if (p_game_data->'teams'->0->>'name') is distinct from s.home_team
    or (p_game_data->'teams'->1->>'name') is distinct from s.away_team then
    raise exception 'Teams do not match the schedule';
  end if;

  select id into v_existing from public.shared_matches where schedule_game_id = p_schedule_id;
  if v_existing is null then
    begin
      v_result := public.create_match_session(
        p_game_data || jsonb_build_object('matchInfo',
          coalesce(p_game_data->'matchInfo', '{}'::jsonb) || jsonb_build_object('startsAt', to_jsonb(v_starts))),
        p_display_name, v_starts);
      update public.shared_matches set schedule_game_id = p_schedule_id
        where id = (v_result->>'match_id')::uuid;
      return v_result;
    exception when unique_violation then
      null; -- another joiner opened the session first; join that one instead
    end;
    select id into v_existing from public.shared_matches where schedule_game_id = p_schedule_id;
  end if;
  return public.join_match_session(v_existing, p_display_name);
end;
$$;


--
-- Name: redact_private_match_players(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redact_private_match_players(p_game jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  person jsonb;
  event jsonb;
  side text;
  cleaned jsonb;
  players jsonb := '[]'::jsonb;
  timeline jsonb := '[]'::jsonb;
  entries jsonb;
  private_ids text[] := '{}';
begin
  if jsonb_typeof(p_game->'players') is distinct from 'array' then
    raise exception 'Match players must be an array';
  end if;
  for person in select value from jsonb_array_elements(p_game->'players') loop
    if person->>'statisticsPrivate' = 'true' or exists (
      select 1 from public.statistics_players p
      where p.is_private and person->>'id' in (p.id::text, 'home-' || p.id::text)
    ) then
      private_ids := array_append(private_ids, person->>'id');
      person := person || jsonb_build_object('name', 'Speler ' || coalesce(person->>'jerseyNumber', ''), 'statisticsPrivate', true);
    end if;
    players := players || jsonb_build_array(person);
  end loop;
  cleaned := jsonb_set(p_game, '{players}', players);
  if jsonb_typeof(p_game->'timeline') = 'array' then
    for event in select value from jsonb_array_elements(p_game->'timeline') loop
      if event->>'type' = 'substitution' then
        foreach side in array array['in', 'out'] loop
          if jsonb_typeof(event->side) = 'array' then
            entries := '[]'::jsonb;
            for person in select value from jsonb_array_elements(event->side) loop
              if person->>'id' = any(private_ids) or exists (
                select 1 from public.statistics_players p
                where p.is_private and person->>'id' in (p.id::text, 'home-' || p.id::text)
              ) then
                person := person || jsonb_build_object('name', 'Speler ' || coalesce(person->>'jerseyNumber', ''));
              end if;
              entries := entries || jsonb_build_array(person);
            end loop;
            event := jsonb_set(event, array[side], entries);
          end if;
        end loop;
      end if;
      timeline := timeline || jsonb_build_array(event);
    end loop;
    cleaned := jsonb_set(cleaned, '{timeline}', timeline);
  end if;
  return cleaned;
end;
$$;


--
-- Name: remove_team_coach(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_team_coach(p_team_id text, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.team_can_manage(p_team_id) then raise exception 'Team manager access required'; end if;
  delete from public.statistics_coaches where team_id = p_team_id and user_id = p_user_id;
end;
$$;


--
-- Name: save_match_scorer_snapshot(uuid, bigint, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_match_scorer_snapshot(p_match_id uuid, p_revision bigint, p_expected_revision bigint, p_snapshot jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_snapshot jsonb;
begin
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  perform 1 from public.shared_matches where id = p_match_id for update;
  if not found then raise exception 'Unknown match'; end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_revision is null or p_revision <= p_expected_revision
     or jsonb_typeof(p_snapshot) is distinct from 'object'
     or octet_length(p_snapshot::text) > 1048576
     or jsonb_typeof(p_snapshot->'teams') is distinct from 'array'
     or jsonb_typeof(p_snapshot->'players') is distinct from 'array'
     or jsonb_typeof(p_snapshot->'actions') is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_snapshot->'players') p
       where jsonb_typeof(p) is distinct from 'object'
         or jsonb_typeof(p->'id') is distinct from 'string'
         or jsonb_typeof(p->'teamId') is distinct from 'string'
         or jsonb_typeof(p->'jerseyNumber') is distinct from 'string'
         or p->>'jerseyNumber' !~ '^([0-9]{1,2})?$'
         or jsonb_typeof(p->'isCoach') is distinct from 'boolean') then
    raise exception 'Invalid snapshot';
  end if;
  select jsonb_build_object(
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', team->'id', 'name', team->'name'))
      from jsonb_array_elements(p_snapshot->'teams') team), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p->'id', 'teamId', p->'teamId', 'jerseyNumber', p->'jerseyNumber', 'isCoach', p->'isCoach',
      'statisticsPrivate', coalesce(p->'statisticsPrivate', 'false'::jsonb)
    )) from jsonb_array_elements(p_snapshot->'players') p), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg((
      select jsonb_object_agg(entry.key, entry.value)
      from jsonb_each(action) entry
      where entry.key in ('id', 'playerId', 'teamId', 'type', 'value', 'createdAt',
        'groupId', 'shotLocation', 'foulType', 'turnoverType', 'period')
    )) from jsonb_array_elements(p_snapshot->'actions') action), '[]'::jsonb),
    'matchDate', p_snapshot->'matchDate',
    'catalogTeamId', p_snapshot->'catalogTeamId'
  ) into v_snapshot;
  if exists (select 1 from public.match_scorer_snapshots
    where match_id = p_match_id and tracker_id = auth.uid()
      and snapshot->>'catalogTeamId' is not null
      and snapshot->>'catalogTeamId' is distinct from v_snapshot->>'catalogTeamId') then
    raise exception 'The scorer team cannot change within a game';
  end if;
  if exists (select 1 from public.statistics_matches where match_id = p_match_id
    and v_snapshot->>'catalogTeamId' is not null and team_id <> v_snapshot->>'catalogTeamId') then
    raise exception 'The scorer team does not match the game';
  end if;
  if p_expected_revision = 0 then
    insert into public.match_scorer_snapshots (match_id, tracker_id, revision, snapshot)
    values (p_match_id, auth.uid(), p_revision, v_snapshot) on conflict do nothing;
    if found then return; end if;
  else
    update public.match_scorer_snapshots set revision = p_revision, snapshot = v_snapshot, updated_at = now()
    where match_id = p_match_id and tracker_id = auth.uid() and revision = p_expected_revision;
    if found then return; end if;
  end if;
  if exists (select 1 from public.match_scorer_snapshots where match_id = p_match_id
    and tracker_id = auth.uid() and revision = p_revision and snapshot = v_snapshot) then
    return;
  end if;
  raise exception 'Scorer snapshot changed on another device; resolve the conflict before syncing';
end;
$_$;


--
-- Name: save_zoebas_jersey_numbers(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_zoebas_jersey_numbers(p_team_id text, p_changes jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  names text[];
  change jsonb;
  v_position integer;
  seen_positions integer[] := '{}';
  current_number text;
  current_name text;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) > 100 then
    raise exception 'Invalid jersey changes';
  end if;
  select player_names into names from public.zoebas_teams where id = p_team_id for update;
  if not found then raise exception 'Unknown team'; end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(change) <> 'object'
       or jsonb_typeof(change->'position') is distinct from 'number'
       or (change->>'position') !~ '^[1-9][0-9]{0,2}$'
       or jsonb_typeof(change->'name') is distinct from 'string'
       or coalesce(jsonb_typeof(change->'expected'), 'missing') not in ('string', 'null')
       or coalesce(jsonb_typeof(change->'number'), 'missing') not in ('string', 'null')
       or (change->>'expected' is not null and change->>'expected' !~ '^[0-9]{1,2}$')
       or (change->>'number' is not null and change->>'number' !~ '^[0-9]{1,2}$') then
      raise exception 'Invalid jersey change';
    end if;
    v_position := (change->>'position')::integer;
    if v_position = any(seen_positions) then raise exception 'Duplicate player position'; end if;
    seen_positions := array_append(seen_positions, v_position);
    if names[v_position] is distinct from change->>'name' then
      raise exception 'Catalog player has changed';
    end if;
    select player_name, jersey_number into current_name, current_number
      from public.zoebas_jersey_numbers
      where team_id = p_team_id and player_position = v_position;
    if current_name is distinct from names[v_position] then current_number := null; end if;
    if current_number is distinct from change->>'expected' then
      raise exception 'Jersey number has changed; reload and try again';
    end if;
    if change->>'number' is null then
      delete from public.zoebas_jersey_numbers where team_id = p_team_id and player_position = v_position;
    else
      insert into public.zoebas_jersey_numbers (team_id, player_position, player_name, jersey_number)
      values (p_team_id, v_position, names[v_position], change->>'number')
      on conflict (team_id, player_position) do update
        set player_name = excluded.player_name, jersey_number = excluded.jersey_number;
    end if;
  end loop;
end;
$_$;


--
-- Name: scheduled_games_with_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scheduled_games_with_stats() RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select distinct m.schedule_game_id
  from public.shared_matches m
  where m.schedule_game_id is not null
    and (
      exists (select 1 from public.match_events e where e.match_id = m.id)
      or exists (select 1 from public.match_scorer_snapshots s where s.match_id = m.id)
    );
$$;


--
-- Name: session_guard_write(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_guard_write(p_match_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_status text := public.session_status(p_match_id);
begin
  if current_setting('watchtower.bypass_session_lock', true) = 'on' then return; end if;
  if v_status is null or v_status in ('open', 'live') then return; end if;
  if v_status = 'in_review' and public.session_has_right(p_match_id, 'finalise_review') then return; end if;
  raise exception 'Session is locked (%)', v_status;
end;
$$;


--
-- Name: session_has_right(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_has_right(p_match_id uuid, p_right text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.shared_matches m
    cross join lateral jsonb_array_elements(m.game_data->'teams') as team(value)
    join public.zoebas_teams zt on zt.name = team.value->>'name'
    where m.id = p_match_id and public.team_has_right(zt.id, p_right)
  );
$$;


--
-- Name: session_is_coach(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_is_coach(p_match_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.shared_matches m
      cross join lateral jsonb_array_elements(m.game_data->'teams') as team(value)
      join public.zoebas_teams zt on zt.name = team.value->>'name'
      join public.statistics_coaches sc on sc.team_id = zt.id
      where m.id = p_match_id and sc.user_id = auth.uid()
    )
    and exists (select 1 from auth.users where id = auth.uid() and is_anonymous = false);
$$;


--
-- Name: session_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_status(p_match_id uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v public.shared_matches%rowtype;
  v_last timestamptz;
  v_auto_close timestamptz;
  v_closing timestamptz;
begin
  select * into v from public.shared_matches where id = p_match_id;
  if not found or v.session_starts_at is null then return null; end if;
  if v.review_status = 'final' then return 'final'; end if;

  select max(received_at) into v_last from public.match_events
    where match_id = p_match_id and counts_as_activity;
  v_auto_close := least(
    v.session_starts_at + interval '180 minutes',
    greatest(v.session_starts_at, coalesce(v_last, v.session_starts_at)) + interval '30 minutes'
  );
  v_closing := least(coalesce(v.session_close_requested_at, v.session_closed_at), v_auto_close);

  if now() >= v_closing + interval '10 minutes' then return 'in_review'; end if;
  if now() >= v_closing then return 'closed'; end if;
  if now() < v.session_starts_at then return 'open'; end if;
  return 'live';
end;
$$;


--
-- Name: set_live_match_tracker(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_live_match_tracker(p_match_id uuid, p_tracker_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_match public.shared_matches%rowtype;
begin
  select * into v_match from public.shared_matches where id = p_match_id for update;
  if not found or v_match.session_starts_at is null then raise exception 'Unknown session'; end if;
  if v_match.scorer_id is not null then raise exception 'Use transfer_match_scorer to change the scorer'; end if;
  if auth.uid() is null or (auth.uid() <> v_match.owner_id
    and not public.statistics_is_coach(v_match.game_data->>'catalogTeamId')) then
    raise exception 'Only the creator or a team coach can choose the live scorer';
  end if;
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = p_tracker_id) then
    raise exception 'The scorer is not a participant';
  end if;
  update public.shared_matches set live_tracker_id = p_tracker_id where id = p_match_id;
end;
$$;


--
-- Name: set_match_score_link(uuid, uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_match_score_link(p_match_id uuid, p_source_id uuid, p_contributor_id uuid, p_contributor_action_id text, p_mode text, p_source_action_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  if p_mode not in ('auto', 'separate', 'linked') or p_contributor_action_id is null
    or length(p_contributor_action_id) not between 1 and 200
    or (p_mode = 'linked') is distinct from (p_source_action_id is not null)
    or (p_source_action_id is not null and length(p_source_action_id) not between 1 and 200) then
    raise exception 'Invalid score link';
  end if;
  if not exists (select 1 from public.shared_matches where id = p_match_id and live_tracker_id = p_source_id)
    or not exists (select 1 from public.match_events where match_id = p_match_id and tracker_id = p_contributor_id
      and action_id = p_contributor_action_id and action_data->>'type' = 'score')
    or (p_source_action_id is not null and not exists (
      select 1 from public.match_events where match_id = p_match_id and tracker_id = p_source_id
        and action_id = p_source_action_id and action_data->>'type' = 'score')) then
    raise exception 'Unknown score to link';
  end if;
  insert into public.match_score_links (match_id, source_tracker_id, contributor_id, contributor_action_id, mode, source_action_id, updated_by)
    values (p_match_id, p_source_id, p_contributor_id, p_contributor_action_id, p_mode, p_source_action_id, auth.uid())
    on conflict (match_id, source_tracker_id, contributor_id, contributor_action_id)
    do update set mode = excluded.mode, source_action_id = excluded.source_action_id, updated_by = excluded.updated_by;
end;
$$;


--
-- Name: set_session_final(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_session_final(p_match_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.session_has_right(p_match_id, 'finalise_review') then
    raise exception 'Only a team coach with finalise rights can finalise a session';
  end if;
  if public.session_status(p_match_id) is distinct from 'in_review' then raise exception 'Session is not in review'; end if;
  update public.shared_matches set review_status = 'final' where id = p_match_id;
end;
$$;


--
-- Name: set_team_coach(text, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_team_coach(p_team_id text, p_email text, p_rights text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_user uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before managing coaches'; end if;
  if not exists (select 1 from public.statistics_teams where id = p_team_id) then raise exception 'Unknown team'; end if;
  if not public.team_can_manage(p_team_id) then raise exception 'Team manager access required'; end if;
  if p_rights is null or not (p_rights <@ array['finalise_review', 'manage_coaches']::text[]) then
    raise exception 'Invalid coach rights';
  end if;
  if 'manage_coaches' = any(p_rights) and not public.is_platform_admin() then
    raise exception 'Only platform admins can grant manage_coaches';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) and is_anonymous = false;
  if v_user is null then raise exception 'No account with that email; the coach must sign in once first'; end if;
  insert into public.statistics_coaches (team_id, user_id, rights) values (p_team_id, v_user, p_rights)
    on conflict (team_id, user_id) do update set rights = excluded.rights;
end;
$$;


--
-- Name: statistics_can_read(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_can_read(p_team_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select auth.uid() is not null and (
    exists (select 1 from public.statistics_team_members where team_id = p_team_id and user_id = auth.uid())
    or (exists (select 1 from public.statistics_coaches where team_id = p_team_id and user_id = auth.uid())
        and exists (select 1 from auth.users where id = auth.uid() and is_anonymous = false))
  )
$$;


--
-- Name: statistics_finish_match(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_finish_match(p_match_id uuid, p_team_id text, p_tracker_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_scorer uuid;
begin
  if not public.statistics_can_read(p_team_id) then raise exception 'Team access required'; end if;
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  select scorer_id into v_scorer from public.shared_matches where id = p_match_id for update;
  if not found then raise exception 'Unknown match'; end if;
  if v_scorer is not null and v_scorer <> p_tracker_id then
    raise exception 'Only the scorer of this match can be the official scorer';
  end if;
  if not exists (select 1 from public.match_scorer_snapshots where match_id = p_match_id and tracker_id = p_tracker_id) then
    raise exception 'Selected scorer has not synchronized a snapshot';
  end if;
  if exists (select 1 from public.match_scorer_snapshots where match_id = p_match_id and tracker_id = p_tracker_id
    and snapshot->>'catalogTeamId' is not null and snapshot->>'catalogTeamId' <> p_team_id) then
    raise exception 'The selected team does not match the game';
  end if;
  if exists (select 1 from public.statistics_matches where match_id = p_match_id and team_id <> p_team_id) then
    raise exception 'The game is already linked to a different team';
  end if;
  update public.shared_matches set finished_at = coalesce(finished_at, now()), official_tracker_id = p_tracker_id
    where id = p_match_id;
  insert into public.statistics_matches (team_id, match_id) values (p_team_id, p_match_id) on conflict do nothing;
end;
$$;


--
-- Name: statistics_history(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_history(p_team_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.statistics_can_read(p_team_id) then raise exception 'No access to this team'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'finishedAt', m.finished_at, 'trackerId', m.official_tracker_id,
      'snapshot', s.snapshot, 'snapshotUpdatedAt', s.updated_at,
      'practice', coalesce(m.game_data->'matchInfo'->>'kind', '') = 'practice',
      'teamClubs', coalesce((select jsonb_object_agg(team->>'id', team->>'club')
        from jsonb_array_elements(m.game_data->'teams') team
        where jsonb_typeof(team->'club') = 'string'), '{}'::jsonb),
      'canEdit', exists (select 1 from public.shared_match_members member where member.match_id = m.id and member.user_id = auth.uid()),
      'links', coalesce((select jsonb_object_agg(l.local_player_id, l.player_id)
        from public.statistics_player_links l where l.team_id = p_team_id and l.match_id = m.id and l.tracker_id = m.official_tracker_id), '{}'::jsonb),
      'contributions', coalesce((select jsonb_agg(jsonb_build_object(
          'trackerId', c.tracker_id, 'trackerName', c.tracker_name, 'actions', c.actions) order by c.tracker_id)
        from (
          select e.tracker_id, max(e.tracker_name) tracker_name, jsonb_agg(e.action_data order by e.sequence_id) actions
          from (
            select distinct on (tracker_id, action_id) tracker_id, tracker_name, event_type, action_data, sequence_id
            from public.match_events
            where match_id = m.id and tracker_id <> m.official_tracker_id
            order by tracker_id, action_id, sequence_id desc
          ) e
          where e.event_type <> 'action_removed'
          group by e.tracker_id
        ) c), '[]'::jsonb),
      'scoreLinks', coalesce((select jsonb_agg(jsonb_build_object(
          'contributorId', k.contributor_id, 'contributorActionId', k.contributor_action_id,
          'mode', k.mode, 'sourceActionId', k.source_action_id))
        from public.match_score_links k
        where k.match_id = m.id and k.source_tracker_id = m.official_tracker_id), '[]'::jsonb)
    ) order by coalesce(s.snapshot->>'matchDate', m.finished_at::date::text) desc, m.finished_at desc), '[]'::jsonb)
    from public.statistics_matches sm
    join public.shared_matches m on m.id = sm.match_id
    left join public.match_scorer_snapshots s on s.match_id = m.id and s.tracker_id = m.official_tracker_id
    where sm.team_id = p_team_id and m.finished_at is not null
  );
end;
$$;


--
-- Name: statistics_is_coach(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_is_coach(p_team_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select auth.uid() is not null
    and exists (select 1 from public.statistics_coaches where team_id = p_team_id and user_id = auth.uid())
    and exists (select 1 from auth.users where id = auth.uid() and is_anonymous = false)
$$;


--
-- Name: statistics_join_team(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_join_team(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_team_id text;
begin
  if auth.uid() is null then raise exception 'Sign in before joining a team'; end if;
  select id into v_team_id from public.statistics_teams where access_code = upper(trim(p_code));
  if not found then raise exception 'Invalid team code'; end if;
  insert into public.statistics_team_members (team_id, user_id) values (v_team_id, auth.uid())
    on conflict do nothing;
  return jsonb_build_object('id', v_team_id);
end;
$$;


--
-- Name: statistics_link_player(text, uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_link_player(p_team_id text, p_match_id uuid, p_tracker_id uuid, p_local_player_id text, p_player_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.statistics_can_read(p_team_id) then raise exception 'Team access required'; end if;
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  if not exists (select 1 from public.match_scorer_snapshots s,
    jsonb_array_elements(s.snapshot->'players') p
    where s.match_id = p_match_id and s.tracker_id = p_tracker_id
      and p->>'id' = p_local_player_id and p->>'teamId' = 'home' and p->>'isCoach' = 'false') then
    raise exception 'Unknown match player';
  end if;
  if p_player_id is null then
    delete from public.statistics_player_links where team_id = p_team_id and match_id = p_match_id
      and tracker_id = p_tracker_id and local_player_id = p_local_player_id;
  else
    insert into public.statistics_player_links (team_id, match_id, tracker_id, local_player_id, player_id)
    values (p_team_id, p_match_id, p_tracker_id, p_local_player_id, p_player_id)
    on conflict (team_id, match_id, tracker_id, local_player_id)
    do update set player_id = excluded.player_id;
  end if;
end;
$$;


--
-- Name: statistics_my_teams(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_my_teams() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', z.name, 'isCoach', public.statistics_is_coach(t.id)
  ) order by z.sort_order), '[]'::jsonb)
  from public.statistics_teams t join public.zoebas_teams z on z.id = t.id
  where public.statistics_can_read(t.id)
$$;


--
-- Name: statistics_roster(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_roster(p_team_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.statistics_can_read(p_team_id) then raise exception 'No access to this team'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'jerseyNumber', p.jersey_number, 'isPrivate', p.is_private,
      'name', case when p.is_private then
        case when public.statistics_is_coach(p_team_id) then n.name else null end
        else p.public_name end
    ) order by nullif(p.jersey_number, '')::integer nulls last, p.id), '[]'::jsonb)
    from public.statistics_players p
    left join public.statistics_private_names n on n.player_id = p.id
    where p.team_id = p_team_id
  );
end;
$$;


--
-- Name: statistics_save_player(text, uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.statistics_save_player(p_team_id text, p_player_id uuid, p_name text, p_number text, p_private boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_id uuid;
begin
  if not public.statistics_is_coach(p_team_id) then raise exception 'Coach access required'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 100
     or p_number is null or p_number !~ '^[0-9]{1,2}$' or p_private is null then
    raise exception 'Invalid player';
  end if;
  if p_player_id is null then
    insert into public.statistics_players (team_id, public_name, jersey_number, is_private)
    values (p_team_id, case when p_private then null else trim(p_name) end, p_number, p_private)
    returning id into v_id;
  else
    update public.statistics_players set public_name = case when p_private then null else trim(p_name) end,
      jersey_number = p_number, is_private = p_private
    where team_id = p_team_id and id = p_player_id returning id into v_id;
    if not found then raise exception 'Unknown player'; end if;
  end if;
  if p_private then
    insert into public.statistics_private_names (player_id, name) values (v_id, trim(p_name))
    on conflict (player_id) do update set name = excluded.name;
  else
    delete from public.statistics_private_names where player_id = v_id;
  end if;
  return v_id;
end;
$_$;


--
-- Name: submit_offline_match(uuid, uuid, jsonb, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_offline_match(p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamp with time zone, p_display_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform set_config('watchtower.bypass_session_lock', 'on', true);
  return public.submit_offline_match_unlocked(p_match_id, p_local_id, p_game_data, p_starts_at, p_display_name);
end;
$$;


--
-- Name: submit_offline_match_unlocked(uuid, uuid, jsonb, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_offline_match_unlocked(p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamp with time zone, p_display_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: team_can_manage(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_can_manage(p_team_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.is_platform_admin() or public.team_has_right(p_team_id, 'manage_coaches');
$$;


--
-- Name: team_has_right(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_has_right(p_team_id text, p_right text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select auth.uid() is not null
    and exists (
      select 1 from public.statistics_coaches sc
      join auth.users u on u.id = sc.user_id
      where sc.team_id = p_team_id and sc.user_id = auth.uid()
        and sc.rights @> array[p_right] and u.is_anonymous = false
    );
$$;


--
-- Name: transfer_match_scorer(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_match_scorer(p_match_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v public.shared_matches%rowtype;
  v_current uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before taking over'; end if;
  select * into v from public.shared_matches where id = p_match_id for update;
  if not found then raise exception 'Unknown match'; end if;
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  v_current := coalesce(v.scorer_id, v.live_tracker_id, v.owner_id);
  if v.scorer_id = auth.uid() then
    return jsonb_build_object('scorerId', auth.uid(), 'previousScorerId', auth.uid(), 'changed', false);
  end if;
  if v_current <> auth.uid() and not public.match_can_take_over(p_match_id) then
    raise exception 'Taking over is not possible for this match';
  end if;
  if v.scorer_id is null and (
    exists (select 1 from public.match_events where match_id = p_match_id and tracker_id <> v_current)
    or exists (select 1 from public.match_scorer_snapshots where match_id = p_match_id and tracker_id <> v_current)
  ) then
    raise exception 'This match already has registrations from several scorers';
  end if;
  update public.shared_matches
    set scorer_id = auth.uid(), live_tracker_id = auth.uid(), scorer_since = now()
    where id = p_match_id;
  return jsonb_build_object('scorerId', auth.uid(), 'previousScorerId', v_current, 'changed', true);
end;
$$;




--
-- Name: match_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_events (
    id uuid NOT NULL,
    match_id uuid NOT NULL,
    tracker_id uuid NOT NULL,
    tracker_name text NOT NULL,
    action_id text NOT NULL,
    event_type text NOT NULL,
    action_data jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    sequence_id bigint NOT NULL,
    counts_as_activity boolean DEFAULT true NOT NULL,
    CONSTRAINT match_events_action_data_check CHECK ((jsonb_typeof(action_data) = 'object'::text)),
    CONSTRAINT match_events_action_data_size CHECK ((octet_length((action_data)::text) <= 16384)),
    CONSTRAINT match_events_event_type_check CHECK ((event_type = ANY (ARRAY['action_added'::text, 'action_updated'::text, 'action_removed'::text]))),
    CONSTRAINT match_events_tracker_name_check CHECK (((length(tracker_name) >= 1) AND (length(tracker_name) <= 60)))
);


--
-- Name: match_events_sequence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.match_events ALTER COLUMN sequence_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.match_events_sequence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: match_offline_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_offline_submissions (
    local_id uuid NOT NULL,
    user_id uuid NOT NULL,
    match_id uuid NOT NULL,
    game_data jsonb NOT NULL
);


--
-- Name: match_score_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_score_links (
    match_id uuid NOT NULL,
    source_tracker_id uuid NOT NULL,
    contributor_id uuid NOT NULL,
    contributor_action_id text NOT NULL,
    mode text NOT NULL,
    source_action_id text,
    updated_by uuid NOT NULL,
    CONSTRAINT match_score_links_check CHECK (((mode = 'linked'::text) = (source_action_id IS NOT NULL))),
    CONSTRAINT match_score_links_mode_check CHECK ((mode = ANY (ARRAY['auto'::text, 'separate'::text, 'linked'::text])))
);


--
-- Name: match_scorer_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_scorer_snapshots (
    match_id uuid NOT NULL,
    tracker_id uuid NOT NULL,
    revision bigint NOT NULL,
    snapshot jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT match_scorer_snapshots_revision_check CHECK ((revision > 0)),
    CONSTRAINT match_scorer_snapshots_snapshot_check CHECK ((octet_length((snapshot)::text) <= 1048576))
);


--
-- Name: opponent_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opponent_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    logo_file text,
    CONSTRAINT opponent_teams_logo_file_check CHECK (((logo_file IS NULL) OR ((length(logo_file) >= 1) AND (length(logo_file) <= 300)))),
    CONSTRAINT opponent_teams_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60)))
);


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    user_id uuid NOT NULL
);


--
-- Name: shared_match_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_match_members (
    match_id uuid NOT NULL,
    user_id uuid NOT NULL,
    display_name text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shared_match_members_display_name_check CHECK (((length(display_name) >= 1) AND (length(display_name) <= 60)))
);


--
-- Name: shared_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    join_code text NOT NULL,
    owner_id uuid NOT NULL,
    game_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    official_tracker_id uuid,
    session_starts_at timestamp with time zone,
    session_closed_at timestamp with time zone,
    live_tracker_id uuid,
    session_close_requested_at timestamp with time zone,
    schedule_game_id text,
    review_status text,
    scorer_id uuid,
    scorer_since timestamp with time zone,
    CONSTRAINT shared_matches_game_data_check CHECK ((jsonb_typeof(game_data) = 'object'::text)),
    CONSTRAINT shared_matches_game_data_size CHECK ((octet_length((game_data)::text) <= 1048576)),
    CONSTRAINT shared_matches_join_code_check CHECK ((join_code ~ '^[A-F0-9]{12}$'::text)),
    CONSTRAINT shared_matches_review_status_check CHECK ((review_status = ANY (ARRAY['in_review'::text, 'final'::text])))
);


--
-- Name: statistics_coaches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_coaches (
    team_id text NOT NULL,
    user_id uuid NOT NULL,
    rights text[] DEFAULT ARRAY['finalise_review'::text] NOT NULL,
    CONSTRAINT statistics_coaches_rights_check CHECK ((rights <@ ARRAY['finalise_review'::text, 'manage_coaches'::text]))
);


--
-- Name: statistics_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_matches (
    team_id text NOT NULL,
    match_id uuid NOT NULL
);


--
-- Name: statistics_player_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_player_links (
    team_id text NOT NULL,
    match_id uuid NOT NULL,
    tracker_id uuid NOT NULL,
    local_player_id text NOT NULL,
    player_id uuid NOT NULL,
    CONSTRAINT statistics_player_links_local_player_id_check CHECK (((length(local_player_id) >= 1) AND (length(local_player_id) <= 200)))
);


--
-- Name: statistics_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_players (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id text NOT NULL,
    public_name text,
    jersey_number text NOT NULL,
    is_private boolean NOT NULL,
    CONSTRAINT statistics_players_check CHECK (((is_private AND (public_name IS NULL)) OR ((NOT is_private) AND (public_name IS NOT NULL) AND ((length(TRIM(BOTH FROM public_name)) >= 1) AND (length(TRIM(BOTH FROM public_name)) <= 100))))),
    CONSTRAINT statistics_players_jersey_number_check CHECK (((jersey_number = ''::text) OR (jersey_number ~ '^[0-9]{1,2}$'::text)))
);


--
-- Name: statistics_private_names; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_private_names (
    player_id uuid NOT NULL,
    name text NOT NULL,
    CONSTRAINT statistics_private_names_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 100)))
);


--
-- Name: statistics_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_team_members (
    team_id text NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: statistics_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_teams (
    id text NOT NULL,
    access_code text DEFAULT upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 24)) NOT NULL
);


--
-- Name: zoebas_competitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoebas_competitions (
    id integer NOT NULL,
    name text NOT NULL,
    CONSTRAINT zoebas_competitions_name_check CHECK (((length(name) >= 1) AND (length(name) <= 120)))
);


--
-- Name: zoebas_jersey_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoebas_jersey_numbers (
    team_id text NOT NULL,
    player_position integer NOT NULL,
    player_name text NOT NULL,
    jersey_number text NOT NULL,
    CONSTRAINT zoebas_jersey_numbers_jersey_number_check CHECK ((jersey_number ~ '^[0-9]{1,2}$'::text)),
    CONSTRAINT zoebas_jersey_numbers_player_position_check CHECK ((player_position > 0))
);


--
-- Name: zoebas_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoebas_schedule (
    id text NOT NULL,
    kind text NOT NULL,
    match_date date NOT NULL,
    start_time time without time zone NOT NULL,
    home_team text NOT NULL,
    away_team text NOT NULL,
    home_score integer,
    away_score integer,
    status text DEFAULT ''::text NOT NULL,
    venue text DEFAULT ''::text NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    home_club text,
    away_club text,
    home_logo_url text,
    away_logo_url text,
    CONSTRAINT zoebas_schedule_away_team_check CHECK (((length(away_team) >= 1) AND (length(away_team) <= 60))),
    CONSTRAINT zoebas_schedule_home_team_check CHECK (((length(home_team) >= 1) AND (length(home_team) <= 60))),
    CONSTRAINT zoebas_schedule_kind_check CHECK ((kind = ANY (ARRAY['program'::text, 'result'::text])))
);


--
-- Name: zoebas_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zoebas_teams (
    id text NOT NULL,
    name text NOT NULL,
    source_team_id uuid NOT NULL,
    player_names text[] DEFAULT '{}'::text[] NOT NULL,
    sort_order integer NOT NULL,
    CONSTRAINT zoebas_teams_name_check CHECK (((length(name) >= 1) AND (length(name) <= 60)))
);


--
-- Name: match_events match_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_events
    ADD CONSTRAINT match_events_pkey PRIMARY KEY (id);


--
-- Name: match_offline_submissions match_offline_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_offline_submissions
    ADD CONSTRAINT match_offline_submissions_pkey PRIMARY KEY (local_id);


--
-- Name: match_score_links match_score_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_score_links
    ADD CONSTRAINT match_score_links_pkey PRIMARY KEY (match_id, source_tracker_id, contributor_id, contributor_action_id);


--
-- Name: match_scorer_snapshots match_scorer_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scorer_snapshots
    ADD CONSTRAINT match_scorer_snapshots_pkey PRIMARY KEY (match_id, tracker_id);


--
-- Name: opponent_teams opponent_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opponent_teams
    ADD CONSTRAINT opponent_teams_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (user_id);


--
-- Name: shared_match_members shared_match_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_match_members
    ADD CONSTRAINT shared_match_members_pkey PRIMARY KEY (match_id, user_id);


--
-- Name: shared_matches shared_matches_join_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_matches
    ADD CONSTRAINT shared_matches_join_code_key UNIQUE (join_code);


--
-- Name: shared_matches shared_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_matches
    ADD CONSTRAINT shared_matches_pkey PRIMARY KEY (id);


--
-- Name: shared_matches shared_matches_schedule_game_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_matches
    ADD CONSTRAINT shared_matches_schedule_game_id_key UNIQUE (schedule_game_id);


--
-- Name: statistics_coaches statistics_coaches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_coaches
    ADD CONSTRAINT statistics_coaches_pkey PRIMARY KEY (team_id, user_id);


--
-- Name: statistics_matches statistics_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_matches
    ADD CONSTRAINT statistics_matches_pkey PRIMARY KEY (team_id, match_id);


--
-- Name: statistics_player_links statistics_player_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_player_links
    ADD CONSTRAINT statistics_player_links_pkey PRIMARY KEY (team_id, match_id, tracker_id, local_player_id);


--
-- Name: statistics_player_links statistics_player_links_team_id_match_id_tracker_id_player__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_player_links
    ADD CONSTRAINT statistics_player_links_team_id_match_id_tracker_id_player__key UNIQUE (team_id, match_id, tracker_id, player_id);


--
-- Name: statistics_players statistics_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_players
    ADD CONSTRAINT statistics_players_pkey PRIMARY KEY (id);


--
-- Name: statistics_players statistics_players_team_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_players
    ADD CONSTRAINT statistics_players_team_id_id_key UNIQUE (team_id, id);


--
-- Name: statistics_private_names statistics_private_names_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_private_names
    ADD CONSTRAINT statistics_private_names_pkey PRIMARY KEY (player_id);


--
-- Name: statistics_team_members statistics_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_team_members
    ADD CONSTRAINT statistics_team_members_pkey PRIMARY KEY (team_id, user_id);


--
-- Name: statistics_teams statistics_teams_access_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_teams
    ADD CONSTRAINT statistics_teams_access_code_key UNIQUE (access_code);


--
-- Name: statistics_teams statistics_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_teams
    ADD CONSTRAINT statistics_teams_pkey PRIMARY KEY (id);


--
-- Name: zoebas_competitions zoebas_competitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoebas_competitions
    ADD CONSTRAINT zoebas_competitions_pkey PRIMARY KEY (id);


--
-- Name: zoebas_jersey_numbers zoebas_jersey_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoebas_jersey_numbers
    ADD CONSTRAINT zoebas_jersey_numbers_pkey PRIMARY KEY (team_id, player_position);


--
-- Name: zoebas_schedule zoebas_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoebas_schedule
    ADD CONSTRAINT zoebas_schedule_pkey PRIMARY KEY (id);


--
-- Name: zoebas_teams zoebas_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoebas_teams
    ADD CONSTRAINT zoebas_teams_pkey PRIMARY KEY (id);


--
-- Name: zoebas_teams zoebas_teams_source_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoebas_teams
    ADD CONSTRAINT zoebas_teams_source_team_id_key UNIQUE (source_team_id);


--
-- Name: match_events_match_sequence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_events_match_sequence_idx ON public.match_events USING btree (match_id, sequence_id);


--
-- Name: match_events_match_time_tracker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_events_match_time_tracker_idx ON public.match_events USING btree (match_id, occurred_at, tracker_id);


--
-- Name: opponent_teams_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opponent_teams_name_key ON public.opponent_teams USING btree (lower(btrim(name)));


--
-- Name: zoebas_schedule_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zoebas_schedule_date_idx ON public.zoebas_schedule USING btree (match_date, start_time);


--
-- Name: zoebas_teams create_statistics_team_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER create_statistics_team_after_insert AFTER INSERT ON public.zoebas_teams FOR EACH ROW EXECUTE FUNCTION public.create_statistics_team();


--
-- Name: match_events match_events_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER match_events_guard BEFORE INSERT ON public.match_events FOR EACH ROW EXECUTE FUNCTION public.match_events_guard();


--
-- Name: match_scorer_snapshots match_snapshot_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER match_snapshot_guard BEFORE INSERT OR UPDATE ON public.match_scorer_snapshots FOR EACH ROW EXECUTE FUNCTION public.match_snapshot_guard();


--
-- Name: shared_matches live_tracker_is_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_matches
    ADD CONSTRAINT live_tracker_is_member FOREIGN KEY (id, live_tracker_id) REFERENCES public.shared_match_members(match_id, user_id);


--
-- Name: match_events match_events_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_events
    ADD CONSTRAINT match_events_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.shared_matches(id) ON DELETE CASCADE;


--
-- Name: match_events match_events_tracker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_events
    ADD CONSTRAINT match_events_tracker_id_fkey FOREIGN KEY (tracker_id) REFERENCES auth.users(id);


--
-- Name: match_offline_submissions match_offline_submissions_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_offline_submissions
    ADD CONSTRAINT match_offline_submissions_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.shared_matches(id);


--
-- Name: match_offline_submissions match_offline_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_offline_submissions
    ADD CONSTRAINT match_offline_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: match_score_links match_score_links_match_id_contributor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_score_links
    ADD CONSTRAINT match_score_links_match_id_contributor_id_fkey FOREIGN KEY (match_id, contributor_id) REFERENCES public.shared_match_members(match_id, user_id);


--
-- Name: match_score_links match_score_links_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_score_links
    ADD CONSTRAINT match_score_links_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.shared_matches(id) ON DELETE CASCADE;


--
-- Name: match_score_links match_score_links_match_id_source_tracker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_score_links
    ADD CONSTRAINT match_score_links_match_id_source_tracker_id_fkey FOREIGN KEY (match_id, source_tracker_id) REFERENCES public.shared_match_members(match_id, user_id);


--
-- Name: match_score_links match_score_links_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_score_links
    ADD CONSTRAINT match_score_links_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: match_scorer_snapshots match_scorer_snapshots_match_id_tracker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_scorer_snapshots
    ADD CONSTRAINT match_scorer_snapshots_match_id_tracker_id_fkey FOREIGN KEY (match_id, tracker_id) REFERENCES public.shared_match_members(match_id, user_id);


--
-- Name: shared_matches official_tracker_is_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_matches
    ADD CONSTRAINT official_tracker_is_member FOREIGN KEY (id, official_tracker_id) REFERENCES public.shared_match_members(match_id, user_id);


--
-- Name: platform_admins platform_admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: shared_matches scorer_is_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_matches
    ADD CONSTRAINT scorer_is_member FOREIGN KEY (id, scorer_id) REFERENCES public.shared_match_members(match_id, user_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: shared_match_members shared_match_members_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_match_members
    ADD CONSTRAINT shared_match_members_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.shared_matches(id) ON DELETE CASCADE;


--
-- Name: shared_match_members shared_match_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_match_members
    ADD CONSTRAINT shared_match_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: shared_matches shared_matches_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_matches
    ADD CONSTRAINT shared_matches_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);


--
-- Name: statistics_coaches statistics_coaches_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_coaches
    ADD CONSTRAINT statistics_coaches_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.statistics_teams(id);


--
-- Name: statistics_coaches statistics_coaches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_coaches
    ADD CONSTRAINT statistics_coaches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: statistics_matches statistics_matches_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_matches
    ADD CONSTRAINT statistics_matches_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.shared_matches(id);


--
-- Name: statistics_matches statistics_matches_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_matches
    ADD CONSTRAINT statistics_matches_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.statistics_teams(id);


--
-- Name: statistics_player_links statistics_player_links_match_id_tracker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_player_links
    ADD CONSTRAINT statistics_player_links_match_id_tracker_id_fkey FOREIGN KEY (match_id, tracker_id) REFERENCES public.shared_match_members(match_id, user_id);


--
-- Name: statistics_player_links statistics_player_links_team_id_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_player_links
    ADD CONSTRAINT statistics_player_links_team_id_match_id_fkey FOREIGN KEY (team_id, match_id) REFERENCES public.statistics_matches(team_id, match_id);


--
-- Name: statistics_player_links statistics_player_links_team_id_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_player_links
    ADD CONSTRAINT statistics_player_links_team_id_player_id_fkey FOREIGN KEY (team_id, player_id) REFERENCES public.statistics_players(team_id, id);


--
-- Name: statistics_players statistics_players_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_players
    ADD CONSTRAINT statistics_players_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.statistics_teams(id);


--
-- Name: statistics_private_names statistics_private_names_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_private_names
    ADD CONSTRAINT statistics_private_names_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.statistics_players(id) ON DELETE CASCADE;


--
-- Name: statistics_team_members statistics_team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_team_members
    ADD CONSTRAINT statistics_team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.statistics_teams(id);


--
-- Name: statistics_team_members statistics_team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_team_members
    ADD CONSTRAINT statistics_team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: statistics_teams statistics_teams_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_teams
    ADD CONSTRAINT statistics_teams_id_fkey FOREIGN KEY (id) REFERENCES public.zoebas_teams(id);


--
-- Name: zoebas_jersey_numbers zoebas_jersey_numbers_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zoebas_jersey_numbers
    ADD CONSTRAINT zoebas_jersey_numbers_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.zoebas_teams(id) ON DELETE CASCADE;


--
-- Name: zoebas_jersey_numbers Anyone can read catalog jersey numbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read catalog jersey numbers" ON public.zoebas_jersey_numbers FOR SELECT TO anon, authenticated USING (true);


--
-- Name: opponent_teams Anyone can read opponent teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read opponent teams" ON public.opponent_teams FOR SELECT TO anon, authenticated USING (true);


--
-- Name: zoebas_schedule Anyone can read the Zoebas schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read the Zoebas schedule" ON public.zoebas_schedule FOR SELECT TO anon, authenticated USING (true);


--
-- Name: zoebas_teams Anyone can read the Zoebas team catalog; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read the Zoebas team catalog" ON public.zoebas_teams FOR SELECT TO anon, authenticated USING (true);


--
-- Name: match_events Members can read match events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read match events" ON public.match_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.shared_match_members member
  WHERE ((member.match_id = match_events.match_id) AND (member.user_id = auth.uid())))));


--
-- Name: match_score_links Members can read score links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read score links" ON public.match_score_links FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.shared_match_members member
  WHERE ((member.match_id = match_score_links.match_id) AND (member.user_id = auth.uid())))));


--
-- Name: shared_match_members Members can read their own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read their own membership" ON public.shared_match_members FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: shared_matches Members can read their shared matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read their shared matches" ON public.shared_matches FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.shared_match_members member
  WHERE ((member.match_id = shared_matches.id) AND (member.user_id = auth.uid())))));


--
-- Name: match_events Trackers can append their own events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Trackers can append their own events" ON public.match_events FOR INSERT TO authenticated WITH CHECK (((tracker_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.shared_match_members member
  WHERE ((member.match_id = match_events.match_id) AND (member.user_id = auth.uid()))))));


--
-- Name: match_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;

--
-- Name: match_offline_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_offline_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: match_score_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_score_links ENABLE ROW LEVEL SECURITY;

--
-- Name: match_scorer_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_scorer_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: opponent_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opponent_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: shared_match_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shared_match_members ENABLE ROW LEVEL SECURITY;

--
-- Name: shared_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shared_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: statistics_coaches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.statistics_coaches ENABLE ROW LEVEL SECURITY;

--
-- Name: statistics_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.statistics_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: statistics_player_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.statistics_player_links ENABLE ROW LEVEL SECURITY;

--
-- Name: statistics_players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.statistics_players ENABLE ROW LEVEL SECURITY;

--
-- Name: statistics_private_names; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.statistics_private_names ENABLE ROW LEVEL SECURITY;

--
-- Name: statistics_team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.statistics_team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: statistics_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.statistics_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: zoebas_competitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zoebas_competitions ENABLE ROW LEVEL SECURITY;

--
-- Name: zoebas_jersey_numbers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zoebas_jersey_numbers ENABLE ROW LEVEL SECURITY;

--
-- Name: zoebas_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zoebas_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: zoebas_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zoebas_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO authenticated;


--
-- Name: FUNCTION admin_dashboard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_dashboard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_dashboard() TO authenticated;


--
-- Name: FUNCTION assert_match_scorer(p_match_id uuid, p_tracker_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assert_match_scorer(p_match_id uuid, p_tracker_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION close_match_session(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.close_match_session(p_match_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_match_session(p_match_id uuid) TO authenticated;


--
-- Name: FUNCTION create_match_session(p_game_data jsonb, p_display_name text, p_starts_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_match_session(p_game_data jsonb, p_display_name text, p_starts_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_match_session(p_game_data jsonb, p_display_name text, p_starts_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION create_shared_match(p_game_data jsonb, p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_shared_match(p_game_data jsonb, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_shared_match(p_game_data jsonb, p_display_name text) TO authenticated;


--
-- Name: FUNCTION create_statistics_team(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_statistics_team() FROM PUBLIC;


--
-- Name: FUNCTION is_platform_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_platform_admin() TO authenticated;


--
-- Name: FUNCTION join_match_session(p_match_id uuid, p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.join_match_session(p_match_id uuid, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_match_session(p_match_id uuid, p_display_name text) TO authenticated;


--
-- Name: FUNCTION join_shared_match(p_join_code text, p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.join_shared_match(p_join_code text, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_shared_match(p_join_code text, p_display_name text) TO authenticated;


--
-- Name: FUNCTION list_match_sessions(p_include_closed boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_match_sessions(p_include_closed boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_match_sessions(p_include_closed boolean) TO authenticated;


--
-- Name: FUNCTION match_can_take_over(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_can_take_over(p_match_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_can_take_over(p_match_id uuid) TO authenticated;


--
-- Name: FUNCTION match_events_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_events_guard() FROM PUBLIC;


--
-- Name: FUNCTION match_scorers(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_scorers(p_match_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_scorers(p_match_id uuid) TO authenticated;


--
-- Name: FUNCTION match_select_official_scorer(p_match_id uuid, p_tracker_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_select_official_scorer(p_match_id uuid, p_tracker_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_select_official_scorer(p_match_id uuid, p_tracker_id uuid) TO authenticated;


--
-- Name: FUNCTION match_snapshot_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_snapshot_guard() FROM PUBLIC;


--
-- Name: FUNCTION my_match_snapshot(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_match_snapshot(p_match_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_match_snapshot(p_match_id uuid) TO authenticated;


--
-- Name: FUNCTION open_schedule_session(p_schedule_id text, p_game_data jsonb, p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.open_schedule_session(p_schedule_id text, p_game_data jsonb, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_schedule_session(p_schedule_id text, p_game_data jsonb, p_display_name text) TO authenticated;


--
-- Name: FUNCTION redact_private_match_players(p_game jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.redact_private_match_players(p_game jsonb) FROM PUBLIC;


--
-- Name: FUNCTION remove_team_coach(p_team_id text, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_team_coach(p_team_id text, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_team_coach(p_team_id text, p_user_id uuid) TO authenticated;


--
-- Name: FUNCTION save_match_scorer_snapshot(p_match_id uuid, p_revision bigint, p_expected_revision bigint, p_snapshot jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_match_scorer_snapshot(p_match_id uuid, p_revision bigint, p_expected_revision bigint, p_snapshot jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_match_scorer_snapshot(p_match_id uuid, p_revision bigint, p_expected_revision bigint, p_snapshot jsonb) TO authenticated;


--
-- Name: FUNCTION save_zoebas_jersey_numbers(p_team_id text, p_changes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_zoebas_jersey_numbers(p_team_id text, p_changes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_zoebas_jersey_numbers(p_team_id text, p_changes jsonb) TO anon;
GRANT ALL ON FUNCTION public.save_zoebas_jersey_numbers(p_team_id text, p_changes jsonb) TO authenticated;


--
-- Name: FUNCTION scheduled_games_with_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.scheduled_games_with_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.scheduled_games_with_stats() TO anon;
GRANT ALL ON FUNCTION public.scheduled_games_with_stats() TO authenticated;


--
-- Name: FUNCTION session_guard_write(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.session_guard_write(p_match_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION session_has_right(p_match_id uuid, p_right text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.session_has_right(p_match_id uuid, p_right text) FROM PUBLIC;


--
-- Name: FUNCTION session_is_coach(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.session_is_coach(p_match_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION session_status(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.session_status(p_match_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION set_live_match_tracker(p_match_id uuid, p_tracker_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_live_match_tracker(p_match_id uuid, p_tracker_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_live_match_tracker(p_match_id uuid, p_tracker_id uuid) TO authenticated;


--
-- Name: FUNCTION set_match_score_link(p_match_id uuid, p_source_id uuid, p_contributor_id uuid, p_contributor_action_id text, p_mode text, p_source_action_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_match_score_link(p_match_id uuid, p_source_id uuid, p_contributor_id uuid, p_contributor_action_id text, p_mode text, p_source_action_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_match_score_link(p_match_id uuid, p_source_id uuid, p_contributor_id uuid, p_contributor_action_id text, p_mode text, p_source_action_id text) TO authenticated;


--
-- Name: FUNCTION set_session_final(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_session_final(p_match_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_session_final(p_match_id uuid) TO authenticated;


--
-- Name: FUNCTION set_team_coach(p_team_id text, p_email text, p_rights text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_team_coach(p_team_id text, p_email text, p_rights text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_team_coach(p_team_id text, p_email text, p_rights text[]) TO authenticated;


--
-- Name: FUNCTION statistics_can_read(p_team_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_can_read(p_team_id text) FROM PUBLIC;


--
-- Name: FUNCTION statistics_finish_match(p_match_id uuid, p_team_id text, p_tracker_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_finish_match(p_match_id uuid, p_team_id text, p_tracker_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.statistics_finish_match(p_match_id uuid, p_team_id text, p_tracker_id uuid) TO authenticated;


--
-- Name: FUNCTION statistics_history(p_team_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_history(p_team_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.statistics_history(p_team_id text) TO authenticated;


--
-- Name: FUNCTION statistics_is_coach(p_team_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_is_coach(p_team_id text) FROM PUBLIC;


--
-- Name: FUNCTION statistics_join_team(p_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_join_team(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.statistics_join_team(p_code text) TO authenticated;


--
-- Name: FUNCTION statistics_link_player(p_team_id text, p_match_id uuid, p_tracker_id uuid, p_local_player_id text, p_player_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_link_player(p_team_id text, p_match_id uuid, p_tracker_id uuid, p_local_player_id text, p_player_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.statistics_link_player(p_team_id text, p_match_id uuid, p_tracker_id uuid, p_local_player_id text, p_player_id uuid) TO authenticated;


--
-- Name: FUNCTION statistics_my_teams(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_my_teams() FROM PUBLIC;
GRANT ALL ON FUNCTION public.statistics_my_teams() TO authenticated;


--
-- Name: FUNCTION statistics_roster(p_team_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_roster(p_team_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.statistics_roster(p_team_id text) TO authenticated;


--
-- Name: FUNCTION statistics_save_player(p_team_id text, p_player_id uuid, p_name text, p_number text, p_private boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.statistics_save_player(p_team_id text, p_player_id uuid, p_name text, p_number text, p_private boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.statistics_save_player(p_team_id text, p_player_id uuid, p_name text, p_number text, p_private boolean) TO authenticated;


--
-- Name: FUNCTION submit_offline_match(p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamp with time zone, p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_offline_match(p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamp with time zone, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_offline_match(p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamp with time zone, p_display_name text) TO authenticated;


--
-- Name: FUNCTION submit_offline_match_unlocked(p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamp with time zone, p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_offline_match_unlocked(p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamp with time zone, p_display_name text) FROM PUBLIC;


--
-- Name: FUNCTION team_can_manage(p_team_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.team_can_manage(p_team_id text) FROM PUBLIC;


--
-- Name: FUNCTION team_has_right(p_team_id text, p_right text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.team_has_right(p_team_id text, p_right text) FROM PUBLIC;


--
-- Name: FUNCTION transfer_match_scorer(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transfer_match_scorer(p_match_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transfer_match_scorer(p_match_id uuid) TO authenticated;


--
-- Name: TABLE match_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.match_events TO authenticated;


--
-- Name: TABLE match_score_links; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.match_score_links TO authenticated;


--
-- Name: TABLE opponent_teams; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.opponent_teams TO anon;
GRANT SELECT ON TABLE public.opponent_teams TO authenticated;


--
-- Name: TABLE shared_match_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.shared_match_members TO authenticated;


--
-- Name: TABLE shared_matches; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.shared_matches TO authenticated;


--
-- Name: TABLE zoebas_jersey_numbers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.zoebas_jersey_numbers TO anon;
GRANT SELECT ON TABLE public.zoebas_jersey_numbers TO authenticated;


--
-- Name: TABLE zoebas_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.zoebas_schedule TO anon;
GRANT SELECT ON TABLE public.zoebas_schedule TO authenticated;


--
-- Name: TABLE zoebas_teams; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.zoebas_teams TO anon;
GRANT SELECT ON TABLE public.zoebas_teams TO authenticated;


--
-- PostgreSQL database dump complete
--

-- Reference data: Zoebas teams and their player names.

insert into public.zoebas_teams (id, name, source_team_id, player_names, sort_order)
values
  ('mse-1', 'MSE-1', 'b5d589db-e873-4b8e-b954-8028ed1a6730', array['Jermain', 'Terrence', 'Jheran', 'Jair', 'Tetilia', 'Immanuel', 'Jayden'], 1),
  ('mse-2', 'MSE-2', 'b25e733a-dbc1-466d-ad90-c2638a327925', array['Hicham', 'Ranil', 'Sjors', 'Robin', 'Jordy', 'Mark', 'Ruben', 'Menno'], 2),
  ('mse-3', 'MSE-3', '19626ef3-fa8f-49eb-9ae1-7257ffcc046f', array['Yannick', 'Yuri', 'Jos', 'Patrick', 'Tim', 'Ezra', 'Richard', 'Joey', 'Michael', 'Stephan', 'Brend'], 3),
  ('vse-1', 'VSE-1', 'f89cf627-b9d4-4e89-98e4-7e1135535068', '{}', 4),
  ('vse-2', 'VSE-2', '39e655a5-9af4-408d-a4b7-3b705795e2b4', '{}', 5),
  ('m22-1', 'M22-1', '62c6e076-c09e-4e74-9ab2-7321590b2acb', array['Jeremy', 'Ryan', 'Wouter', 'Laurens', 'Sean', 'Dani', 'Justin', 'Sam', 'Nikan', 'Messi', 'Sam', 'Denver'], 6),
  ('m22-2', 'M22-2', 'e083e832-0a9a-477a-83e3-d92dc16319ba', array['Obdia', 'Tristen', 'Kris', 'Cas', 'Salvador', 'Owen', 'Milan', 'Colin', 'Quint', 'Finn'], 7),
  ('v22-1', 'V22-1', '2100b898-99bf-4c48-b90a-eaa966915ab1', array['Gemma', 'Julica', 'Yasmin', 'Isa', 'Iris', 'Vera', 'Daphne'], 8),
  ('m18-1', 'M18-1', '562dd440-3d50-4196-8893-7b065552cc1e', array['Demirhan', 'Dean', 'Djelano', 'Sam', 'Eldgie', 'Jens', 'Valentijn', 'Semii', 'Florian', 'D''andre', 'Luca'], 9),
  ('m18-2', 'M18-2', '98253a5a-6f23-4eca-9dd8-23136a08c564', array['Antoni', 'Maik', 'Jaivyn', 'Julian', 'Lasse', 'Noah', 'Menno', 'Ruben'], 10),
  ('v18-1', 'V18-1', 'c7660a71-b186-46ab-8db6-2f90edc4de8e', array['Joyceline', 'Senna', 'Jarah', 'Charlotte', 'Ilse', 'Eline', 'Isabel', 'Charissa'], 11),
  ('v18-2', 'V18-2', '8b50eb88-79bc-42b8-8b68-13fbb350ceb6', array['Dewi', 'Kyra', 'Maren', 'Naomi', 'Lola', 'Livia', 'Jula', 'Nena'], 12),
  ('m16-1', 'M16-1', '5a42d637-87c4-4df5-9cdb-fa97b5829ef3', array['Mats', 'Sam', 'Dean', 'Nathan', 'Denver', 'Mitchell', 'Tijl'], 13),
  ('m16-2', 'M16-2', '04067a6f-6b3a-45b5-a106-0879c2249280', array['Jussi', 'Quint', 'Parsa', 'Isaiah', 'Jesse', 'Jordan', 'Jacy', 'Stef', 'Cebrian', 'Zihao', 'Milan'], 14),
  ('m16-3', 'M16-3', '28b48777-51fe-422c-98a8-e624d5c653e8', array['Davin', 'Senna', 'Jaël', 'Tudor', 'Ede', 'Jelte', 'Abel', 'Victor', 'Lee'], 15),
  ('m16-4', 'M16-4', 'e0bc8ec9-dadd-4fdf-b55b-5be9707a7118', array['Maurits', 'Timo', 'Rohit', 'Liam', 'Adanto', 'Jaimy', 'Bektaş'], 16),
  ('v16-1', 'V16-1', 'e1855dd3-dfb9-4026-985d-5bda7947ab1e', array['Tebarek', 'Safia', 'Fenne', 'Fenna', 'Suryani', 'Noa', 'Lente'], 17),
  ('x14-1', 'X14-1', 'ad9365c1-b945-49f8-95e1-3b9ddcfc14c9', array['Myson', 'Phyllon', 'Logan', 'Ryan', 'Feda', 'Silvester', 'Marcus'], 18),
  ('x14-2', 'X14-2', '6a9961a8-6f5b-4656-b6a2-a5ecd3948dbd', array['Darren', 'Sam', 'Lieuwe', 'Lex', 'Tyler', 'Julius'], 19),
  ('v14-1', 'V14-1', '98015f0a-79f0-42e5-b028-ad7aa0ad3551', array['Lina', 'Noa', 'Sofía', 'Nora', 'Jelaysa', 'Meerle', 'Fenna', 'Jaya'], 20),
  ('x12-1', 'X12-1', '558bf1f5-735f-4b0c-8796-b49b997d3823', array['Marley', 'Stef', 'Mees', 'Maciej', 'Tim', 'Morris', 'Noud', 'Milan', 'Viggo'], 21),
  ('x12-2', 'X12-2', 'a0b1b911-3b19-4d6a-a610-0668b5be33af', array['MJ', 'Kian', 'Armin', 'Lorenzo', 'Shai', 'Thomas', 'Sem', 'Ümit'], 22),
  ('v12-1', 'V12-1', '48be1759-7275-484c-9efb-3a9e059152ac', array['Sofia', 'Fenna', 'Fleur', 'Jade', 'Veerle', 'Isa', 'Zoe', 'Julia', 'Nina', 'Kayla'], 23),
  ('x10-1', 'X10-1', '5c729e87-a0ce-419a-8fb5-4ab4f8e76650', array['Jaro', 'Fynn', 'Jort', 'Levi', 'Nick', 'Kasper', 'Luuk'], 24),
  ('x10-2', 'X10-2', 'b3bf03f8-0001-4bae-8d81-ec1c2aab0710', array['Quinten', 'Thiago', 'Senn', 'Kyan', 'Owen', 'Jaylison', 'Lex', 'Ekrem'], 25)
on conflict (id) do update set
  name = excluded.name,
  source_team_id = excluded.source_team_id,
  player_names = excluded.player_names,
  sort_order = excluded.sort_order;


-- Reference data: competitions in the FOYS schedule.

insert into public.zoebas_competitions (id, name) values
  (5802, 'Vrouwen U22 Regionaal 1e Helft Competitie - 3e divisie'),
  (5803, 'Mannen U19 Landelijk - M19 Eredivisie'),
  (5804, 'Vrouwen U18 Landelijk - Eredivisie'),
  (5805, 'Mannen U12 Landelijk - Eredivisie'),
  (5806, 'Mannen U14 Landelijk - Eredivisie'),
  (5807, 'Mannen U16 Landelijk - Eredivisie'),
  (5809, 'Mannen Senioren Landelijk - BNXT League'),
  (5810, 'Vrouwen U21 Landelijk - V21 Eredivisie'),
  (5811, 'Vrouwen Senioren Landelijk - Women''s Basketball League'),
  (5812, 'Mannen Senioren Landelijk - Promotiedivisie'),
  (5813, 'Vrouwen Senioren Landelijk - Promotiedivisie'),
  (5814, 'Mannen Senioren Landelijk - 1e divisie'),
  (5815, 'Vrouwen Senioren Landelijk - 1e divisie'),
  (5816, 'Mannen U14 Landelijk - 1e divisie'),
  (5817, 'Mannen U16 Landelijk - 1e divisie'),
  (5818, 'Gemengd U10 Regionaal 1e Helft Competitie - 4e divisie'),
  (5819, 'Mannen U22 Landelijk - 1e divisie'),
  (5820, 'Mannen Senioren Regionaal - 2e divisie'),
  (5821, 'Vrouwen U14 Landelijk - 1e divisie'),
  (5822, 'Vrouwen U16 Landelijk - 1e divisie'),
  (5823, 'Vrouwen U18 Landelijk - 1e divisie'),
  (5824, 'Vrouwen U14 Regionaal 1e Helft Competitie - 4e divisie'),
  (5825, 'Vrouwen Senioren Regionaal - 2e divisie'),
  (5826, 'Mannen U22 Landelijk - Eredivisie'),
  (5827, 'Vrouwen U16 Landelijk - Eredivisie'),
  (5828, 'Vrouwen U14 Landelijk - Eredivisie'),
  (5861, 'Mannen Senioren Regionaal - 3e divisie'),
  (5864, 'Mannen Senioren Regionaal - 4e divisie'),
  (5866, 'Mannen Senioren Regionaal - 5e divisie'),
  (5868, 'Vrouwen Senioren Regionaal - 3e divisie'),
  (5869, 'Vrouwen Senioren Regionaal - 4e divisie'),
  (5871, 'Gemengd U12 Regionaal 1e Helft Competitie - 2e divisie'),
  (5872, 'Gemengd U14 Regionaal 1e Helft Competitie - 2e divisie'),
  (5873, 'Mannen U16 Regionaal 1e Helft Competitie - 2e divisie'),
  (5874, 'Mannen U18 Regionaal 1e Helft Competitie - 2e divisie'),
  (5876, 'Mannen U22 Regionaal 1e Helft Competitie - 2e divisie'),
  (5877, 'Vrouwen U14 Regionaal 1e Helft Competitie - 2e divisie'),
  (5880, 'Gemengd U10 Regionaal 1e Helft Competitie - 3e divisie'),
  (5881, 'Gemengd U12 Regionaal 1e Helft Competitie - 3e divisie'),
  (5882, 'Gemengd U14 Regionaal 1e Helft Competitie - 3e divisie'),
  (5883, 'Mannen U16 Regionaal 1e Helft Competitie - 3e divisie'),
  (5884, 'Mannen U18 Regionaal 1e Helft Competitie - 3e divisie'),
  (5886, 'Mannen U22 Regionaal 1e Helft Competitie - 3e divisie'),
  (5887, 'Vrouwen U12 Regionaal 1e Helft Competitie - 3e divisie'),
  (5888, 'Vrouwen U14 Regionaal 1e Helft Competitie - 3e divisie'),
  (5889, 'Vrouwen U16 Regionaal 1e Helft Competitie - 3e divisie'),
  (5890, 'Vrouwen U18 Regionaal 1e Helft Competitie - 3e divisie'),
  (5891, 'Gemengd U12 Regionaal 1e Helft Competitie - 4e divisie'),
  (5892, 'Gemengd U14 Regionaal 1e Helft Competitie - 4e divisie'),
  (5893, 'Mannen U16 Regionaal 1e Helft Competitie - 4e divisie'),
  (5894, 'Mannen U18 Regionaal 1e Helft Competitie - 4e divisie'),
  (5896, 'Mannen U22 Regionaal 1e Helft Competitie - 4e divisie'),
  (5902, 'Gemengd U12 Regionaal 1e Helft Competitie - 5e divisie'),
  (5903, 'Gemengd U14 Regionaal 1e Helft Competitie - 5e divisie'),
  (5904, 'Mannen U16 Regionaal 1e Helft Competitie - 5e divisie'),
  (5907, 'Mannen U19 Landelijk - 1e divisie'),
  (5973, 'Vrouwen U16 (Basketball Cup) - 2e ronde'),
  (5978, '3X3NL League'),
  (6013, 'Vrouwen U18 (Basketball Cup) - 2e ronde'),
  (6015, 'Mannen U19 (Basketball Cup) - 2e ronde'),
  (6018, 'Vrouwen U21 (Basketball Cup) - Groepsfase'),
  (6025, 'Vrouwen Senioren (Basketball Cup) - 2e ronde'),
  (6039, 'Mannen Senioren (Basketball Cup) - 2e Ronde'),
  (6042, 'Mannen U22 (Basketball Cup) - 2e ronde'),
  (6044, 'Mannen U16 (Basketball Cup) - 2e ronde'),
  (6057, 'MSE - Vriendschappelijke wedstrijden'),
  (6060, 'Rolstoel Senioren - Rolstoel 2e Divisie'),
  (6062, 'Rolstoel Senioren - SKO Eredivisie'),
  (6063, 'Rolstoel Senioren - Rolstoel 1e Divisie')
on conflict (id) do update set name = excluded.name;


-- Statistics teams and players are derived from the Zoebas catalog.

insert into public.statistics_teams (id)
select id from public.zoebas_teams
on conflict (id) do nothing;


insert into public.statistics_players (team_id, public_name, jersey_number, is_private)
select team.id, player.name, coalesce(jersey.jersey_number, ''), false
from public.zoebas_teams team
cross join lateral unnest(team.player_names) with ordinality as player(name, position)
left join public.zoebas_jersey_numbers jersey
  on jersey.team_id = team.id and jersey.player_position = player.position and jersey.player_name = player.name;


-- Supabase-only: realtime publication, public logos bucket and the logo import (empty on a new project).

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_events') then
    alter publication supabase_realtime add table public.match_events;
  end if;
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_matches') then
    alter publication supabase_realtime add table public.shared_matches;
  end if;
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_score_links') then
    alter publication supabase_realtime add table public.match_score_links;
  end if;
end;
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set public = true where id = 'logos' and public is not true;
  end if;
end
$$;

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

RESET check_function_bodies;
