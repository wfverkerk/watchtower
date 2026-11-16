-- Single scorer per match, server side (phase 1).
-- A match with a scorer_id accepts events and snapshots only from that scorer; everyone else in the match can read.
-- Matches without a scorer_id behave exactly as before, so this migration changes nothing until a match gets a scorer:
-- transfer_match_scorer assigns one, and a later migration will assign the creator automatically.
alter table public.shared_matches
  add column if not exists scorer_id uuid,
  add column if not exists scorer_since timestamptz;

-- Deferred so a match and its creating scorer can be inserted in either order within one transaction.
alter table public.shared_matches
  add constraint scorer_is_member foreign key (id, scorer_id)
  references public.shared_match_members(match_id, user_id) deferrable initially deferred;

create function public.assert_match_scorer(p_match_id uuid, p_tracker_id uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare v_scorer uuid;
begin
  select scorer_id into v_scorer from public.shared_matches where id = p_match_id;
  if v_scorer is not null and v_scorer is distinct from p_tracker_id then
    raise exception 'not_scorer: only the scorer of this match can register actions';
  end if;
end;
$$;
revoke all on function public.assert_match_scorer(uuid, uuid) from public, anon, authenticated;

create or replace function public.match_events_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_status text := public.session_status(new.match_id);
begin
  perform public.assert_match_scorer(new.match_id, new.tracker_id);
  if v_status is null or v_status in ('open', 'live') then return new; end if;
  perform public.session_guard_write(new.match_id);
  new.counts_as_activity := false;
  return new;
end;
$$;

create or replace function public.match_snapshot_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_match_scorer(new.match_id, new.tracker_id);
  perform public.session_guard_write(new.match_id);
  return new;
end;
$$;

-- Whether the caller may take over the scorer role: a member while the match is open or live and not finished,
-- or a team coach while the session is in review.
create function public.match_can_take_over(p_match_id uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
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
revoke all on function public.match_can_take_over(uuid) from public, anon;
grant execute on function public.match_can_take_over(uuid) to authenticated;

-- Makes the caller the scorer. Events and snapshots of the previous scorer that arrive later are rejected by the guards.
-- On a match that has no scorer yet this activates the single-scorer rules, which is only allowed while
-- nobody else has registered anything.
create function public.transfer_match_scorer(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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
revoke all on function public.transfer_match_scorer(uuid) from public, anon;
grant execute on function public.transfer_match_scorer(uuid) to authenticated;

-- The scorer follows the single-scorer rules, so the live scorer can no longer be chosen separately.
create or replace function public.set_live_match_tracker(p_match_id uuid, p_tracker_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
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

-- With a scorer, the statistics always use that scorer's snapshot.
create or replace function public.statistics_finish_match(p_match_id uuid, p_team_id text, p_tracker_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
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

create or replace function public.match_select_official_scorer(p_match_id uuid, p_tracker_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
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
