-- Club names and logo URLs from the Foys match data. Team names stay in home_team / away_team.
alter table public.zoebas_schedule
  add column if not exists home_club text,
  add column if not exists away_club text,
  add column if not exists home_logo_url text,
  add column if not exists away_logo_url text;
