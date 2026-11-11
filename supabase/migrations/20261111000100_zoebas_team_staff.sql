alter table public.zoebas_teams
  add column if not exists coach_names text[] not null default '{}';

update public.zoebas_teams
set coach_names = array['Willem']
where id = 'x12-1'
  and cardinality(coach_names) = 0;
