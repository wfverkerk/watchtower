-- The live state of a match, shared by its scorer so viewers can follow along: period, lineup, roster and the substitution timeline.
-- Only the scorer writes it; everyone who joined the match can read it, and receives changes through realtime.
create table public.match_live_state (
  match_id uuid primary key references public.shared_matches(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 65536),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.match_live_state enable row level security;
revoke all on public.match_live_state from public, anon, authenticated;
grant select on public.match_live_state to authenticated;
create policy "Members can read the live state" on public.match_live_state for select to authenticated
  using (exists (
    select 1 from public.shared_match_members member
    where member.match_id = public.match_live_state.match_id and member.user_id = auth.uid()
  ));

create function public.set_match_live_state(p_match_id uuid, p_state jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_scorer uuid;
begin
  select scorer_id into v_scorer from public.shared_matches where id = p_match_id;
  if not found then raise exception 'Unknown match'; end if;
  if v_scorer is distinct from auth.uid() then
    raise exception 'not_scorer: only the scorer of this match can share the live state';
  end if;
  perform public.session_guard_write(p_match_id);
  if jsonb_typeof(p_state) is distinct from 'object' or octet_length(p_state::text) > 65536 then
    raise exception 'Invalid live state';
  end if;
  insert into public.match_live_state (match_id, state, updated_by)
    values (p_match_id, p_state, auth.uid())
    on conflict (match_id) do update set state = excluded.state, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.set_match_live_state(uuid, jsonb) from public, anon;
grant execute on function public.set_match_live_state(uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_live_state') then
    alter publication supabase_realtime add table public.match_live_state;
  end if;
end;
$$;
