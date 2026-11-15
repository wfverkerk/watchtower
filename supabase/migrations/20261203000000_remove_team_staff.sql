-- Coaches are no longer part of a team's lineup or roster. Coach access rights (statistics_coaches) are unchanged.
alter table public.zoebas_teams
  drop column if exists coach_names,
  drop column if exists coach_roles;
