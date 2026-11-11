alter table public.zoebas_teams
  add column if not exists coach_roles text[] not null default '{}';

update public.zoebas_teams as teams
set
  coach_names = staff.names,
  coach_roles = staff.roles
from (values
  ('mse-1', array['Simon']::text[], array['Coach']::text[]),
  ('mse-2', array['Robin']::text[], array['Coach']::text[]),
  ('mse-3', array['Ezra', 'Richard']::text[], array['Coach', 'Assistent coach']::text[]),
  ('vse-1', array[]::text[], array[]::text[]),
  ('vse-2', array[]::text[], array[]::text[]),
  ('m22-1', array['Simon']::text[], array['Coach']::text[]),
  ('m22-2', array['Charony', 'Ingeborg']::text[], array['Coach', 'Coach']::text[]),
  ('v22-1', array['Ester']::text[], array['Coach']::text[]),
  ('m18-1', array['Tyron']::text[], array['Coach']::text[]),
  ('m18-2', array['Dieudonné', 'Simon']::text[], array['Coach', 'Coach']::text[]),
  ('v18-1', array['Melissa']::text[], array['Coach']::text[]),
  ('v18-2', array[]::text[], array[]::text[]),
  ('m16-1', array['Donny']::text[], array['Coach']::text[]),
  ('m16-2', array[]::text[], array[]::text[]),
  ('m16-3', array['Nico']::text[], array['Coach']::text[]),
  ('m16-4', array['Robertico', 'Daphne']::text[], array['Coach', 'Coach']::text[]),
  ('v16-1', array['Tim']::text[], array['Coach']::text[]),
  ('x14-1', array['Yannick', 'Eric']::text[], array['Coach', 'Coach']::text[]),
  ('x14-2', array[]::text[], array[]::text[]),
  ('v14-1', array['Dennis', 'Julica']::text[], array['Coach', 'Coach']::text[]),
  ('x12-1', array['Willem']::text[], array['Coach']::text[]),
  ('x12-2', array[]::text[], array[]::text[]),
  ('v12-1', array['Milan', 'Ingeborg']::text[], array['Coach', 'Coach']::text[]),
  ('x10-1', array[]::text[], array[]::text[]),
  ('x10-2', array['Charlotte', 'Ester']::text[], array['Coach', 'Coach']::text[])
) as staff(id, names, roles)
where teams.id = staff.id;
