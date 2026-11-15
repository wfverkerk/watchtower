-- Practice games are set up by hand outside the schedule (matchInfo.kind = 'practice' in the match data).
-- The statistics history marks them so the app can leave them out of player totals and trends.
-- teamClubs carries a typed opponent club per team id, which the scorer snapshot does not keep.
create or replace function public.statistics_history(p_team_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.statistics_can_read(p_team_id) then raise exception 'No access to this team'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'finishedAt', m.finished_at, 'trackerId', m.official_tracker_id,
      'snapshot', s.snapshot, 'snapshotUpdatedAt', s.updated_at,
      'practice', coalesce(m.game_data->'matchInfo'->>'kind', '') = 'practice',
      'teamClubs', coalesce((select jsonb_object_agg(team->>'id', team->>'club')
        from jsonb_array_elements(m.game_data->'teams') team
        where jsonb_typeof(team->'club') = 'string'), '{}'::jsonb),
      'canEdit', exists (select 1 from public.shared_match_members member where member.match_id = m.id and member.user_id = auth.uid()),
      'links', coalesce((select jsonb_object_agg(l.local_player_id, l.player_id)
        from public.statistics_player_links l where l.team_id = p_team_id and l.match_id = m.id and l.tracker_id = m.official_tracker_id), '{}'::jsonb),
      'contributions', coalesce((select jsonb_agg(jsonb_build_object(
          'trackerId', c.tracker_id, 'trackerName', c.tracker_name, 'actions', c.actions) order by c.tracker_id)
        from (
          select e.tracker_id, max(e.tracker_name) tracker_name, jsonb_agg(e.action_data order by e.sequence_id) actions
          from (
            select distinct on (tracker_id, action_id) tracker_id, tracker_name, event_type, action_data, sequence_id
            from public.match_events
            where match_id = m.id and tracker_id <> m.official_tracker_id
            order by tracker_id, action_id, sequence_id desc
          ) e
          where e.event_type <> 'action_removed'
          group by e.tracker_id
        ) c), '[]'::jsonb),
      'scoreLinks', coalesce((select jsonb_agg(jsonb_build_object(
          'contributorId', k.contributor_id, 'contributorActionId', k.contributor_action_id,
          'mode', k.mode, 'sourceActionId', k.source_action_id))
        from public.match_score_links k
        where k.match_id = m.id and k.source_tracker_id = m.official_tracker_id), '[]'::jsonb)
    ) order by coalesce(s.snapshot->>'matchDate', m.finished_at::date::text) desc, m.finished_at desc), '[]'::jsonb)
    from public.statistics_matches sm
    join public.shared_matches m on m.id = sm.match_id
    left join public.match_scorer_snapshots s on s.match_id = m.id and s.tracker_id = m.official_tracker_id
    where sm.team_id = p_team_id and m.finished_at is not null
  );
end;
$$;
