-- Matches are joined through their session (join_match_session); the join code is no longer used.
-- create_match_session writes the match itself, so create_shared_match and join_shared_match can be removed.

create or replace function public.create_match_session(p_game_data jsonb, p_display_name text, p_starts_at timestamptz) returns jsonb
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_match_id uuid;
  v_name text := nullif(trim(p_display_name), '');
  clean_game jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in anonymously before creating a match.'; end if;
  if v_name is null or length(v_name) > 60 then
    raise exception 'Display name must contain 1 to 60 characters.';
  end if;
  if p_game_data is null or jsonb_typeof(p_game_data) <> 'object' then
    raise exception 'Match data must be a JSON object.';
  end if;
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
  clean_game := public.redact_private_match_players(p_game_data);
  insert into public.shared_matches (owner_id, game_data, session_starts_at)
    values (auth.uid(), clean_game, p_starts_at)
    returning id into v_match_id;
  insert into public.shared_match_members (match_id, user_id, display_name)
    values (v_match_id, auth.uid(), v_name);
  update public.shared_matches set live_tracker_id = auth.uid() where id = v_match_id;
  return jsonb_build_object('match_id', v_match_id, 'game_data', clean_game);
end;
$$;

create or replace function public.join_match_session(p_match_id uuid, p_display_name text) returns jsonb
    language plpgsql security definer
    set search_path to ''
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
  return jsonb_build_object('match_id', v_match.id, 'game_data', v_match.game_data);
end;
$$;

drop function if exists public.join_shared_match(text, text);
drop function if exists public.create_shared_match(jsonb, text);
alter table public.shared_matches drop column join_code;
