alter table public.shared_matches
  add column session_starts_at timestamptz,
  add column session_closed_at timestamptz,
  add column live_tracker_id uuid;

alter table public.shared_matches
  add constraint live_tracker_is_member foreign key (id, live_tracker_id)
  references public.shared_match_members(match_id, user_id);

alter table public.match_events
  add column sequence_id bigint generated always as identity;

create index match_events_match_sequence_idx on public.match_events (match_id, sequence_id);

create table public.match_offline_submissions (
  local_id uuid not null,
  user_id uuid not null references auth.users(id),
  match_id uuid not null references public.shared_matches(id),
  game_data jsonb not null,
  primary key (local_id)
);

create table public.match_score_links (
  match_id uuid not null references public.shared_matches(id) on delete cascade,
  source_tracker_id uuid not null,
  contributor_id uuid not null,
  contributor_action_id text not null,
  mode text not null check (mode in ('auto', 'separate', 'linked')),
  source_action_id text,
  updated_by uuid not null references auth.users(id),
  primary key (match_id, source_tracker_id, contributor_id, contributor_action_id),
  foreign key (match_id, source_tracker_id) references public.shared_match_members(match_id, user_id),
  foreign key (match_id, contributor_id) references public.shared_match_members(match_id, user_id),
  check ((mode = 'linked') = (source_action_id is not null))
);

alter table public.match_offline_submissions enable row level security;
revoke all on public.match_offline_submissions from public, anon, authenticated;
alter table public.match_score_links enable row level security;
create policy "Members can read score links" on public.match_score_links for select to authenticated
  using (exists (select 1 from public.shared_match_members member
    where member.match_id = public.match_score_links.match_id and member.user_id = auth.uid()));
grant select on public.match_score_links to authenticated;

create function public.set_match_score_link(
  p_match_id uuid, p_source_id uuid, p_contributor_id uuid, p_contributor_action_id text,
  p_mode text, p_source_action_id text
) returns void language plpgsql security definer set search_path = ''
as $$
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

create function public.create_match_session(p_game_data jsonb, p_display_name text, p_starts_at timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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

create function public.list_match_sessions(p_include_closed boolean default false)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'startsAt', m.session_starts_at,
    'teams', (select jsonb_agg(jsonb_build_object('id', t->'id', 'name', t->'name', 'color', t->'color') order by ordinal)
      from jsonb_array_elements(m.game_data->'teams') with ordinality as item(t, ordinal)),
    'canClose', auth.uid() = m.owner_id or public.statistics_is_coach(m.game_data->>'catalogTeamId'),
    'closed', m.session_closed_at is not null or now() >= m.session_starts_at + interval '180 minutes'
  ) order by m.session_starts_at), '[]'::jsonb)
  from public.shared_matches m
  where m.session_starts_at is not null
    and (p_include_closed or (m.session_closed_at is null
      and now() < m.session_starts_at + interval '180 minutes'))
$$;

create function public.join_match_session(p_match_id uuid, p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_match public.shared_matches%rowtype;
  v_name text := nullif(trim(p_display_name), '');
begin
  if auth.uid() is null then raise exception 'Sign in before joining a match'; end if;
  if v_name is null or length(v_name) > 60 then raise exception 'Display name must contain 1 to 60 characters'; end if;
  select * into v_match from public.shared_matches where id = p_match_id for update;
  if not found or v_match.session_starts_at is null then raise exception 'Unknown session'; end if;
  if now() < v_match.session_starts_at - interval '10 minutes' then raise exception 'Session has not opened yet'; end if;
  if v_match.session_closed_at is not null or now() >= v_match.session_starts_at + interval '180 minutes' then
    raise exception 'Session is closed';
  end if;
  insert into public.shared_match_members (match_id, user_id, display_name)
    values (v_match.id, auth.uid(), v_name)
    on conflict (match_id, user_id) do update set display_name = excluded.display_name;
  return jsonb_build_object('match_id', v_match.id, 'join_code', v_match.join_code, 'game_data', v_match.game_data);
end;
$$;

create function public.close_match_session(p_match_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.shared_matches%rowtype;
begin
  select * into v_match from public.shared_matches where id = p_match_id for update;
  if not found or v_match.session_starts_at is null then raise exception 'Unknown session'; end if;
  if auth.uid() is null or (auth.uid() <> v_match.owner_id
    and not public.statistics_is_coach(v_match.game_data->>'catalogTeamId')) then
    raise exception 'Only the creator or a team coach can close the session';
  end if;
  update public.shared_matches set session_closed_at = coalesce(session_closed_at, now()) where id = p_match_id;
end;
$$;

create function public.set_live_match_tracker(p_match_id uuid, p_tracker_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_match public.shared_matches%rowtype;
begin
  select * into v_match from public.shared_matches where id = p_match_id for update;
  if not found or v_match.session_starts_at is null then raise exception 'Unknown session'; end if;
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

create or replace function public.match_scorers(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  return (
    select jsonb_build_object(
      'finishedAt', m.finished_at, 'officialTrackerId', m.official_tracker_id,
      'liveTrackerId', m.live_tracker_id,
      'canManageLive', m.session_starts_at is not null and
        (auth.uid() = m.owner_id or public.statistics_is_coach(m.game_data->>'catalogTeamId')),
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

create function public.submit_offline_match(
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
        and not (jsonb_typeof(a->'playerId') is not distinct from 'null' and a->>'type' = 'score'))
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
        or a->>'turnoverType' not in ('turnover', 'second_dribble', 'travel')))
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

create or replace function public.join_shared_match(p_join_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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

revoke all on function public.create_match_session(jsonb, text, timestamptz),
  public.list_match_sessions(boolean), public.join_match_session(uuid, text),
  public.close_match_session(uuid), public.set_live_match_tracker(uuid, uuid),
  public.set_match_score_link(uuid, uuid, uuid, text, text, text),
  public.submit_offline_match(uuid, uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.create_match_session(jsonb, text, timestamptz),
  public.list_match_sessions(boolean), public.join_match_session(uuid, text),
  public.close_match_session(uuid), public.set_live_match_tracker(uuid, uuid),
  public.set_match_score_link(uuid, uuid, uuid, text, text, text),
  public.submit_offline_match(uuid, uuid, jsonb, timestamptz, text) to authenticated;

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
