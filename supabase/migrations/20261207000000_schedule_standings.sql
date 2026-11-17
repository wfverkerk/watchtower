-- Ranking positions per scheduled game. The sync stores the competition and the team ids of each match. On the first
-- refresh of a week (Monday) the positions of that week's upcoming games are stored; position_week records which week.
alter table public.zoebas_schedule
  add column if not exists competition_id integer,
  add column if not exists home_team_guid text,
  add column if not exists away_team_guid text,
  add column if not exists home_position integer,
  add column if not exists away_position integer,
  add column if not exists position_week date;
