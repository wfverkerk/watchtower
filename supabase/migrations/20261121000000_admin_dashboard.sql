-- Platform admins and per-team coach rights.
-- Rights: finalise_review (edit and finalise sessions in review), manage_coaches (add/remove coaches of the team).
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

-- Existing coaches keep the right they had before: finalising reviews.
alter table public.statistics_coaches
  add column if not exists rights text[] not null default array['finalise_review']
    check (rights <@ array['finalise_review', 'manage_coaches']::text[]);

create function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create function public.team_has_right(p_team_id text, p_right text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.statistics_coaches sc
      join auth.users u on u.id = sc.user_id
      where sc.team_id = p_team_id and sc.user_id = auth.uid()
        and sc.rights @> array[p_right] and u.is_anonymous = false
    );
$$;

create function public.session_has_right(p_match_id uuid, p_right text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.shared_matches m
    cross join lateral jsonb_array_elements(m.game_data->'teams') as team(value)
    join public.zoebas_teams zt on zt.name = team.value->>'name'
    where m.id = p_match_id and public.team_has_right(zt.id, p_right)
  );
$$;

create or replace function public.session_guard_write(p_match_id uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare v_status text := public.session_status(p_match_id);
begin
  if current_setting('watchtower.bypass_session_lock', true) = 'on' then return; end if;
  if v_status is null or v_status in ('open', 'live') then return; end if;
  if v_status = 'in_review' and public.session_has_right(p_match_id, 'finalise_review') then return; end if;
  raise exception 'Session is locked (%)', v_status;
end;
$$;

create or replace function public.set_session_final(p_match_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.session_has_right(p_match_id, 'finalise_review') then
    raise exception 'Only a team coach with finalise rights can finalise a session';
  end if;
  if public.session_status(p_match_id) is distinct from 'in_review' then raise exception 'Session is not in review'; end if;
  update public.shared_matches set review_status = 'final' where id = p_match_id;
end;
$$;

create or replace function public.list_match_sessions(p_include_closed boolean default false)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'scheduleId', m.schedule_game_id, 'startsAt', m.session_starts_at, 'status', s.status,
    'teams', (select jsonb_agg(jsonb_build_object('id', t->'id', 'name', t->'name', 'color', t->'color') order by ordinal)
      from jsonb_array_elements(m.game_data->'teams') with ordinality as item(t, ordinal)),
    'canClose', auth.uid() = m.owner_id or public.session_is_coach(m.id),
    'canReview', public.session_has_right(m.id, 'finalise_review'),
    'closed', s.status not in ('open', 'live')
  ) order by m.session_starts_at), '[]'::jsonb)
  from public.shared_matches m
  cross join lateral (select public.session_status(m.id) as status) s
  where m.session_starts_at is not null
    and (p_include_closed or s.status in ('open', 'live'));
$$;

create function public.team_can_manage(p_team_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_platform_admin() or public.team_has_right(p_team_id, 'manage_coaches');
$$;

-- Adds or updates a coach of a team. Only platform admins can grant manage_coaches.
create function public.set_team_coach(p_team_id text, p_email text, p_rights text[])
returns void language plpgsql security definer set search_path = ''
as $$
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

create function public.remove_team_coach(p_team_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.team_can_manage(p_team_id) then raise exception 'Team manager access required'; end if;
  delete from public.statistics_coaches where team_id = p_team_id and user_id = p_user_id;
end;
$$;

create function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
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

revoke all on function public.is_platform_admin(), public.team_has_right(text, text),
  public.session_has_right(uuid, text), public.team_can_manage(text), public.admin_dashboard(),
  public.set_team_coach(text, text, text[]), public.remove_team_coach(text, uuid),
  public.set_session_final(uuid) from public, anon;
grant execute on function public.is_platform_admin(), public.admin_dashboard(),
  public.set_team_coach(text, text, text[]), public.remove_team_coach(text, uuid),
  public.set_session_final(uuid) to authenticated;
