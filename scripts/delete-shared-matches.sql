-- One-time cleanup: removes all existing shared matches (sessions and deelbare wedstrijden) with their events,
-- scorer snapshots, live state, score links, members and the team statistics that were built from them.
-- Teams, players, the Zoebas schedule and coach access are kept. Run once in the Supabase SQL editor.
begin;

delete from public.statistics_player_links
  where match_id in (select id from public.shared_matches);
delete from public.statistics_matches
  where match_id in (select id from public.shared_matches);
delete from public.match_offline_submissions
  where match_id in (select id from public.shared_matches);
delete from public.match_scorer_snapshots;
delete from public.match_live_state;
delete from public.match_score_links;
delete from public.match_events;
delete from public.shared_match_members;
delete from public.shared_matches;

commit;
