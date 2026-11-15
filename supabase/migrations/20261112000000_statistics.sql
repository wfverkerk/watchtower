create table public.statistics_teams (
  id text primary key references public.zoebas_teams(id),
  access_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24))
);

insert into public.statistics_teams (id)
select id from public.zoebas_teams
on conflict (id) do nothing;

create function public.create_statistics_team()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.statistics_teams (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger create_statistics_team_after_insert
  after insert on public.zoebas_teams for each row execute function public.create_statistics_team();
revoke all on function public.create_statistics_team() from public, anon, authenticated;

create table public.statistics_team_members (
  team_id text not null references public.statistics_teams(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (team_id, user_id)
);

create table public.statistics_coaches (
  team_id text not null references public.statistics_teams(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (team_id, user_id)
);

create table public.statistics_players (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.statistics_teams(id),
  public_name text,
  jersey_number text not null check (jersey_number = '' or jersey_number ~ '^[0-9]{1,2}$'),
  is_private boolean not null,
  check ((is_private and public_name is null) or
         (not is_private and public_name is not null and length(trim(public_name)) between 1 and 100)),
  unique (team_id, id)
);

insert into public.statistics_players (team_id, public_name, jersey_number, is_private)
select team.id, player.name, coalesce(jersey.jersey_number, ''), false
from public.zoebas_teams team
cross join lateral unnest(team.player_names) with ordinality as player(name, position)
left join public.zoebas_jersey_numbers jersey
  on jersey.team_id = team.id and jersey.player_position = player.position and jersey.player_name = player.name;

create table public.statistics_private_names (
  player_id uuid primary key references public.statistics_players(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100)
);

create function public.redact_private_match_players(p_game jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
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

create or replace function public.create_shared_match(p_game_data jsonb, p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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

revoke all on function public.redact_private_match_players(jsonb) from public, anon, authenticated;

create table public.match_scorer_snapshots (
  match_id uuid not null,
  tracker_id uuid not null,
  revision bigint not null check (revision > 0),
  snapshot jsonb not null check (octet_length(snapshot::text) <= 1048576),
  updated_at timestamptz not null default now(),
  primary key (match_id, tracker_id),
  foreign key (match_id, tracker_id) references public.shared_match_members(match_id, user_id)
);

alter table public.shared_matches
  add column finished_at timestamptz,
  add column official_tracker_id uuid;

alter table public.shared_matches
  add constraint official_tracker_is_member foreign key (id, official_tracker_id)
  references public.shared_match_members(match_id, user_id);

create table public.statistics_matches (
  team_id text not null references public.statistics_teams(id),
  match_id uuid not null references public.shared_matches(id),
  primary key (team_id, match_id)
);

create table public.statistics_player_links (
  team_id text not null,
  match_id uuid not null,
  tracker_id uuid not null,
  local_player_id text not null check (length(local_player_id) between 1 and 200),
  player_id uuid not null,
  primary key (team_id, match_id, tracker_id, local_player_id),
  unique (team_id, match_id, tracker_id, player_id),
  foreign key (team_id, match_id) references public.statistics_matches(team_id, match_id),
  foreign key (match_id, tracker_id) references public.shared_match_members(match_id, user_id),
  foreign key (team_id, player_id) references public.statistics_players(team_id, id)
);

alter table public.statistics_teams enable row level security;
alter table public.statistics_team_members enable row level security;
alter table public.statistics_coaches enable row level security;
alter table public.statistics_players enable row level security;
alter table public.statistics_private_names enable row level security;
alter table public.match_scorer_snapshots enable row level security;
alter table public.statistics_matches enable row level security;
alter table public.statistics_player_links enable row level security;

revoke all on public.statistics_teams, public.statistics_team_members, public.statistics_coaches,
  public.statistics_players, public.statistics_private_names, public.match_scorer_snapshots,
  public.statistics_matches, public.statistics_player_links from public, anon, authenticated;

create function public.statistics_can_read(p_team_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.statistics_team_members where team_id = p_team_id and user_id = auth.uid())
    or (exists (select 1 from public.statistics_coaches where team_id = p_team_id and user_id = auth.uid())
        and exists (select 1 from auth.users where id = auth.uid() and is_anonymous = false))
  )
$$;

create function public.statistics_is_coach(p_team_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and exists (select 1 from public.statistics_coaches where team_id = p_team_id and user_id = auth.uid())
    and exists (select 1 from auth.users where id = auth.uid() and is_anonymous = false)
$$;

create function public.statistics_join_team(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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

create function public.statistics_my_teams()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', z.name, 'isCoach', public.statistics_is_coach(t.id)
  ) order by z.sort_order), '[]'::jsonb)
  from public.statistics_teams t join public.zoebas_teams z on z.id = t.id
  where public.statistics_can_read(t.id)
$$;

create function public.statistics_roster(p_team_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
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

create function public.statistics_save_player(p_team_id text, p_player_id uuid, p_name text, p_number text, p_private boolean)
returns uuid language plpgsql security definer set search_path = ''
as $$
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
$$;

create function public.save_match_scorer_snapshot(p_match_id uuid, p_revision bigint, p_expected_revision bigint, p_snapshot jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
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
$$;

create function public.match_scorers(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  return (
    select jsonb_build_object(
      'finishedAt', m.finished_at, 'officialTrackerId', m.official_tracker_id,
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

create function public.my_match_snapshot(p_match_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('revision', revision, 'snapshot', snapshot)
  from public.match_scorer_snapshots
  where match_id = p_match_id and tracker_id = auth.uid()
$$;

create function public.statistics_finish_match(p_match_id uuid, p_team_id text, p_tracker_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.statistics_can_read(p_team_id) then raise exception 'Team access required'; end if;
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  perform 1 from public.shared_matches where id = p_match_id for update;
  if not found then raise exception 'Unknown match'; end if;
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

create function public.match_select_official_scorer(p_match_id uuid, p_tracker_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.shared_match_members where match_id = p_match_id and user_id = auth.uid()) then
    raise exception 'Match membership required';
  end if;
  perform 1 from public.shared_matches where id = p_match_id for update;
  if not found then raise exception 'Unknown match'; end if;
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

create function public.statistics_link_player(p_team_id text, p_match_id uuid, p_tracker_id uuid, p_local_player_id text, p_player_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
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

create function public.statistics_history(p_team_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.statistics_can_read(p_team_id) then raise exception 'No access to this team'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'finishedAt', m.finished_at, 'trackerId', m.official_tracker_id,
      'snapshot', s.snapshot, 'snapshotUpdatedAt', s.updated_at,
      'canEdit', exists (select 1 from public.shared_match_members member where member.match_id = m.id and member.user_id = auth.uid()),
      'links', coalesce((select jsonb_object_agg(l.local_player_id, l.player_id)
        from public.statistics_player_links l where l.team_id = p_team_id and l.match_id = m.id and l.tracker_id = m.official_tracker_id), '{}'::jsonb)
    ) order by coalesce(s.snapshot->>'matchDate', m.finished_at::date::text) desc, m.finished_at desc), '[]'::jsonb)
    from public.statistics_matches sm
    join public.shared_matches m on m.id = sm.match_id
    left join public.match_scorer_snapshots s on s.match_id = m.id and s.tracker_id = m.official_tracker_id
    where sm.team_id = p_team_id and m.finished_at is not null
  );
end;
$$;

revoke all on function public.statistics_can_read(text), public.statistics_is_coach(text),
  public.statistics_join_team(text), public.statistics_my_teams(), public.statistics_roster(text),
  public.statistics_save_player(text, uuid, text, text, boolean),
  public.save_match_scorer_snapshot(uuid, bigint, bigint, jsonb), public.match_scorers(uuid), public.my_match_snapshot(uuid),
  public.statistics_finish_match(uuid, text, uuid), public.match_select_official_scorer(uuid, uuid),
  public.statistics_link_player(text, uuid, uuid, text, uuid), public.statistics_history(text)
  from public, anon;
grant execute on function public.statistics_join_team(text), public.statistics_my_teams(),
  public.statistics_roster(text), public.statistics_save_player(text, uuid, text, text, boolean),
  public.save_match_scorer_snapshot(uuid, bigint, bigint, jsonb), public.match_scorers(uuid), public.my_match_snapshot(uuid),
  public.statistics_finish_match(uuid, text, uuid), public.match_select_official_scorer(uuid, uuid),
  public.statistics_link_player(text, uuid, uuid, text, uuid), public.statistics_history(text) to authenticated;
