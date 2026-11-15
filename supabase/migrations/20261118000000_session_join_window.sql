alter table public.shared_matches add column if not exists session_close_requested_at timestamptz;

-- A session is closed when it was finalised, when a close was requested more than 10 minutes ago,
-- or when it is 180 minutes past its start. Joining is allowed from 15 minutes before the start.
create or replace function public.session_is_closed(
  p_closed_at timestamptz, p_close_requested_at timestamptz, p_starts_at timestamptz
) returns boolean language sql stable set search_path = ''
as $$
  select p_closed_at is not null
    or (p_close_requested_at is not null and now() >= p_close_requested_at + interval '10 minutes')
    or now() >= p_starts_at + interval '180 minutes';
$$;

revoke all on function public.session_is_closed(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.list_match_sessions(p_include_closed boolean default false)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'startsAt', m.session_starts_at,
    'teams', (select jsonb_agg(jsonb_build_object('id', t->'id', 'name', t->'name', 'color', t->'color') order by ordinal)
      from jsonb_array_elements(m.game_data->'teams') with ordinality as item(t, ordinal)),
    'canClose', auth.uid() = m.owner_id or public.statistics_is_coach(m.game_data->>'catalogTeamId'),
    'closed', public.session_is_closed(m.session_closed_at, m.session_close_requested_at, m.session_starts_at)
  ) order by m.session_starts_at), '[]'::jsonb)
  from public.shared_matches m
  where m.session_starts_at is not null
    and (p_include_closed or not public.session_is_closed(m.session_closed_at, m.session_close_requested_at, m.session_starts_at));
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
  if public.session_is_closed(v_match.session_closed_at, v_match.session_close_requested_at, v_match.session_starts_at) then
    raise exception 'Session is closed';
  end if;
  insert into public.shared_match_members (match_id, user_id, display_name)
    values (v_match.id, auth.uid(), v_name)
    on conflict (match_id, user_id) do update set display_name = excluded.display_name;
  return jsonb_build_object('match_id', v_match.id, 'join_code', v_match.join_code, 'game_data', v_match.game_data);
end;
$$;

-- Closing gives the session 10 more minutes before it is definitively closed.
create or replace function public.close_match_session(p_match_id uuid)
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
  update public.shared_matches
    set session_close_requested_at = coalesce(session_close_requested_at, now())
    where id = p_match_id;
end;
$$;
