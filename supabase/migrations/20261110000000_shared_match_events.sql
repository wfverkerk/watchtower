create table public.shared_matches (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique check (join_code ~ '^[A-F0-9]{12}$'),
  owner_id uuid not null references auth.users(id),
  game_data jsonb not null check (jsonb_typeof(game_data) = 'object'),
  created_at timestamptz not null default now()
);

create table public.shared_match_members (
  match_id uuid not null references public.shared_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 60),
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table public.match_events (
  id uuid primary key,
  match_id uuid not null references public.shared_matches(id) on delete cascade,
  tracker_id uuid not null references auth.users(id),
  tracker_name text not null check (length(tracker_name) between 1 and 60),
  action_id text not null,
  event_type text not null check (event_type in ('action_added', 'action_updated', 'action_removed')),
  action_data jsonb not null check (jsonb_typeof(action_data) = 'object'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index match_events_match_time_tracker_idx
  on public.match_events (match_id, occurred_at, tracker_id);

alter table public.shared_matches enable row level security;
alter table public.shared_match_members enable row level security;
alter table public.match_events enable row level security;

create policy "Members can read their shared matches"
  on public.shared_matches for select to authenticated
  using (
    exists (
      select 1
      from public.shared_match_members member
      where member.match_id = id and member.user_id = auth.uid()
    )
  );

create policy "Members can read their own membership"
  on public.shared_match_members for select to authenticated
  using (user_id = auth.uid());

create policy "Members can read match events"
  on public.match_events for select to authenticated
  using (
    exists (
      select 1
      from public.shared_match_members member
      where member.match_id = public.match_events.match_id and member.user_id = auth.uid()
    )
  );

create policy "Trackers can append their own events"
  on public.match_events for insert to authenticated
  with check (
    tracker_id = auth.uid()
    and exists (
      select 1
      from public.shared_match_members member
      where member.match_id = public.match_events.match_id and member.user_id = auth.uid()
    )
  );

create or replace function public.create_shared_match(p_game_data jsonb, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_match_id uuid;
  new_join_code text;
  clean_display_name text := nullif(trim(p_display_name), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in anonymously before creating a match.';
  end if;
  if clean_display_name is null or length(clean_display_name) > 60 then
    raise exception 'Display name must contain 1 to 60 characters.';
  end if;
  if p_game_data is null or jsonb_typeof(p_game_data) <> 'object' then
    raise exception 'Match data must be a JSON object.';
  end if;

  loop
    new_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.shared_matches (join_code, owner_id, game_data)
    values (new_join_code, auth.uid(), p_game_data)
    on conflict (join_code) do nothing
    returning id into created_match_id;
    exit when created_match_id is not null;
  end loop;

  insert into public.shared_match_members (match_id, user_id, display_name)
  values (created_match_id, auth.uid(), clean_display_name);

  return jsonb_build_object(
    'match_id', created_match_id,
    'join_code', new_join_code,
    'game_data', p_game_data
  );
end;
$$;

create or replace function public.join_shared_match(p_join_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  shared_match public.shared_matches%rowtype;
  clean_display_name text := nullif(trim(p_display_name), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in anonymously before joining a match.';
  end if;
  if clean_display_name is null or length(clean_display_name) > 60 then
    raise exception 'Display name must contain 1 to 60 characters.';
  end if;

  select *
    into shared_match
    from public.shared_matches
    where join_code = upper(trim(p_join_code));

  if not found then
    raise exception 'No match was found for that code.';
  end if;

  insert into public.shared_match_members (match_id, user_id, display_name)
  values (shared_match.id, auth.uid(), clean_display_name)
  on conflict (match_id, user_id) do update
    set display_name = excluded.display_name;

  return jsonb_build_object(
    'match_id', shared_match.id,
    'join_code', shared_match.join_code,
    'game_data', shared_match.game_data
  );
end;
$$;

revoke all on function public.create_shared_match(jsonb, text) from public, anon;
revoke all on function public.join_shared_match(text, text) from public, anon;
grant execute on function public.create_shared_match(jsonb, text) to authenticated;
grant execute on function public.join_shared_match(text, text) to authenticated;
grant usage on schema public to authenticated;
grant select on public.shared_matches, public.shared_match_members to authenticated;
grant select, insert on public.match_events to authenticated;
