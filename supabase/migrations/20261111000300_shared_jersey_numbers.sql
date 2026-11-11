create table public.zoebas_jersey_numbers (
  team_id text not null references public.zoebas_teams(id) on delete cascade,
  player_position integer not null check (player_position > 0),
  player_name text not null,
  jersey_number text not null check (jersey_number ~ '^[0-9]{1,2}$'),
  primary key (team_id, player_position)
);

alter table public.zoebas_jersey_numbers enable row level security;
create policy "Anyone can read catalog jersey numbers"
  on public.zoebas_jersey_numbers for select to anon, authenticated using (true);
grant select on public.zoebas_jersey_numbers to anon, authenticated;
revoke insert, update, delete on public.zoebas_jersey_numbers from anon, authenticated;

create function public.save_zoebas_jersey_numbers(p_team_id text, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.save_zoebas_jersey_numbers(text, jsonb) from public;
grant execute on function public.save_zoebas_jersey_numbers(text, jsonb) to anon, authenticated;
