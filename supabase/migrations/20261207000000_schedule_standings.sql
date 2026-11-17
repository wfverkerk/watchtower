-- Ranking positions per scheduled game. The sync stores the competition and the team ids of each match and
-- refreshes home_position and away_position until the game starts; after that the value stays as it was.
alter table public.zoebas_schedule
  add column if not exists competition_id integer,
  add column if not exists home_team_guid text,
  add column if not exists away_team_guid text,
  add column if not exists home_position integer,
  add column if not exists away_position integer;
