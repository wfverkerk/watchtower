-- Cap the size of client-supplied JSON so anonymous users cannot store arbitrarily large documents.
alter table public.shared_matches
  add constraint shared_matches_game_data_size
  check (octet_length(game_data::text) <= 1048576);

alter table public.match_events
  add constraint match_events_action_data_size
  check (octet_length(action_data::text) <= 16384);
