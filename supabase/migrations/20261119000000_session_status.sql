-- Session lifecycle: open -> live -> closed -> in_review -> final.
-- open: before the start. live: from the start until a closing trigger.
-- closed: 10 minutes after a manual close. in_review: after closing, writes only by a team coach.
-- final: set by a coach while in_review; locked for everyone.
alter table public.shared_matches
  add column if not exists schedule_game_id text unique,
  add column if not exists review_status text check (review_status in ('in_review', 'final'));

-- Coach corrections during review are not activity, so they never extend the 10-minute no-events rule.
alter table public.match_events add column if not exists counts_as_activity boolean not null default true;

drop function if exists public.session_is_closed(timestamptz, timestamptz, timestamptz);

create function public.session_is_coach(p_match_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
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

create function public.session_status(p_match_id uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.shared_matches%rowtype;
  v_last timestamptz;
  v_auto_close timestamptz;
begin
  select * into v from public.shared_matches where id = p_match_id;
  if not found or v.session_starts_at is null then return null; end if;
  if v.review_status = 'final' then return 'final'; end if;

  if coalesce(v.session_close_requested_at, v.session_closed_at) is not null then
    if now() < coalesce(v.session_close_requested_at, v.session_closed_at) + interval '10 minutes' then
      return 'closed';
    end if;
    return 'in_review';
  end if;

  select max(received_at) into v_last from public.match_events
    where match_id = p_match_id and counts_as_activity;
  v_auto_close := least(
    v.session_starts_at + interval '180 minutes',
    greatest(v.session_starts_at, coalesce(v_last, v.session_starts_at)) + interval '10 minutes'
  );
  if now() >= v_auto_close then return 'in_review'; end if;
  if now() < v.session_starts_at then return 'open'; end if;
  return 'live';
end;
$$;

create function public.match_events_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_status text := public.session_status(new.match_id);
begin
  if v_status is null or v_status in ('open', 'live') then return new; end if;
  perform public.session_guard_write(new.match_id);
  new.counts_as_activity := false;
  return new;
end;
$$;

create trigger match_events_guard before insert on public.match_events
  for each row execute function public.match_events_guard();

create function public.match_snapshot_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.session_guard_write(new.match_id);
  return new;
end;
$$;

create trigger match_snapshot_guard before insert or update on public.match_scorer_snapshots
  for each row execute function public.match_snapshot_guard();

create or replace function public.list_match_sessions(p_include_closed boolean default false)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'scheduleId', m.schedule_game_id, 'startsAt', m.session_starts_at, 'status', s.status,
    'teams', (select jsonb_agg(jsonb_build_object('id', t->'id', 'name', t->'name', 'color', t->'color') order by ordinal)
      from jsonb_array_elements(m.game_data->'teams') with ordinality as item(t, ordinal)),
    'canClose', auth.uid() = m.owner_id or public.session_is_coach(m.id),
    'canReview', public.session_is_coach(m.id),
    'closed', s.status not in ('open', 'live')
  ) order by m.session_starts_at), '[]'::jsonb)
  from public.shared_matches m
  cross join lateral (select public.session_status(m.id) as status) s
  where m.session_starts_at is not null
    and (p_include_closed or s.status in ('open', 'live'));
$$;

create or replace function public.join_match_session(p_match_id uuid, p_display_name text)
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
  if now() < v_match.session_starts_at - interval '15 minutes' then raise exception 'Session has not opened yet'; end if;
  if public.session_status(v_match.id) not in ('open', 'live') then raise exception 'Session is closed'; end if;
  insert into public.shared_match_members (match_id, user_id, display_name)
    values (v_match.id, auth.uid(), v_name)
    on conflict (match_id, user_id) do update set display_name = excluded.display_name;
  return jsonb_build_object('match_id', v_match.id, 'join_code', v_match.join_code, 'game_data', v_match.game_data);
end;
$$;

-- Opens the session for a scheduled game the first time someone joins it. Later joiners get the same session.
create function public.open_schedule_session(p_schedule_id text, p_game_data jsonb, p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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

create function public.set_session_final(p_match_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.session_is_coach(p_match_id) then raise exception 'Only a team coach can finalise a session'; end if;
  if public.session_status(p_match_id) is distinct from 'in_review' then raise exception 'Session is not in review'; end if;
  update public.shared_matches set review_status = 'final' where id = p_match_id;
end;
$$;

revoke all on function public.session_is_coach(uuid), public.session_status(uuid),
  public.match_events_guard(), public.match_snapshot_guard(),
  public.open_schedule_session(text, jsonb, text), public.set_session_final(uuid) from public, anon;
grant execute on function public.open_schedule_session(text, jsonb, text), public.set_session_final(uuid) to authenticated;

-- Offline pushes are the one exception to the lock: a local game is submitted once (deduplicated on
-- local_id) even after its session closed. The bypass is transaction-local and only set by this wrapper.
alter function public.submit_offline_match(uuid, uuid, jsonb, timestamptz, text) rename to submit_offline_match_unlocked;
revoke all on function public.submit_offline_match_unlocked(uuid, uuid, jsonb, timestamptz, text) from public, anon, authenticated;

create function public.submit_offline_match(
  p_match_id uuid, p_local_id uuid, p_game_data jsonb, p_starts_at timestamptz, p_display_name text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('watchtower.bypass_session_lock', 'on', true);
  return public.submit_offline_match_unlocked(p_match_id, p_local_id, p_game_data, p_starts_at, p_display_name);
end;
$$;

revoke all on function public.submit_offline_match(uuid, uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.submit_offline_match(uuid, uuid, jsonb, timestamptz, text) to authenticated;

create or replace function public.session_guard_write(p_match_id uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare v_status text := public.session_status(p_match_id);
begin
  if current_setting('watchtower.bypass_session_lock', true) = 'on' then return; end if;
  if v_status is null or v_status in ('open', 'live') then return; end if;
  if v_status = 'in_review' and public.session_is_coach(p_match_id) then return; end if;
  raise exception 'Session is locked (%)', v_status;
end;
$$;
revoke all on function public.session_guard_write(uuid) from public, anon;
