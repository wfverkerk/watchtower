import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const db = new PGlite()
const coach = '11111111-1111-4111-8111-111111111111'
const viewer = '22222222-2222-4222-8222-222222222222'
const outsider = '33333333-3333-4333-8333-333333333333'

async function asUser(id: string) {
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`)
}

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create schema storage;
    create table storage.objects (bucket_id text, name text);
    insert into storage.objects values ('logos', 'SV ZOEBAS.png'), ('logos', 'SV ZOEBAS.jpg'), ('logos', 'RAP ÉLAN.WEBP'),
      ('logos', 'notes.txt'), ('other', 'ELSEWHERE.png'), ('logos', 'folder/NESTED.png');
  `)
  const directory = 'supabase/migrations'
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`${directory}/${file}`, 'utf8'))
  }
}, 30_000)
afterAll(async () => { await db.close() })

describe('statistics database authorization', () => {
  it('protects private names and history, preserves revisions and lets match members change the scorer', async () => {
    await db.exec(`insert into auth.users (id, is_anonymous) values ('${coach}', false), ('${viewer}', true), ('${outsider}', false);
      insert into public.statistics_coaches values ('x12-1', '${coach}'), ('x12-1', '${viewer}');`)
    const code = (await db.query<{ access_code: string }>("select access_code from public.statistics_teams where id='x12-1'")).rows[0].access_code
    const otherCode = (await db.query<{ access_code: string }>("select access_code from public.statistics_teams where id='x12-2'")).rows[0].access_code

    await asUser(coach)
    await db.query("select public.statistics_save_player('x12-1', null, 'Secret Name', '12', true)")
    const coachRoster = (await db.query<{ roster: { id: string; name: string | null; isPrivate: boolean }[] }>(
      "select public.statistics_roster('x12-1') roster",
    )).rows[0].roster
    const privatePlayer = coachRoster.find((player) => player.isPrivate)!
    expect(privatePlayer.name).toBe('Secret Name')

    await asUser(outsider)
    await expect(db.query("select public.statistics_roster('x12-1')")).rejects.toThrow('No access')
    await expect(db.query("select public.statistics_history('x12-1')")).rejects.toThrow('No access')
    await expect(db.query("select public.statistics_save_player('x12-1', null, 'Test', '1', false)")).rejects.toThrow('Coach access')

    await asUser(viewer)
    await db.query('select public.statistics_join_team($1)', [code])
    await db.query('select public.statistics_join_team($1)', [otherCode])
    const publicRoster = (await db.query<{ roster: { name: string | null; isPrivate: boolean }[] }>(
      "select public.statistics_roster('x12-1') roster",
    )).rows[0].roster
    expect(publicRoster.find((player) => player.isPrivate)?.name).toBeNull()
    await expect(db.query('select * from public.statistics_private_names')).rejects.toThrow('permission denied')
    await expect(db.query("select public.statistics_save_player('x12-1', null, 'Test', '1', false)")).rejects.toThrow('Coach access')

    const localId = `home-${privatePlayer.id}`
    const created = (await db.query<{ result: { match_id: string; join_code: string; game_data: unknown } }>(
      "select public.create_shared_match($1, 'Viewer') result",
      [{ players: [{ id: localId, name: 'Secret Name', jerseyNumber: '12' }],
        timeline: [{ type: 'substitution', in: [{ id: localId, name: 'Secret Name', jerseyNumber: '12' }], out: [] }] }],
    )).rows[0].result
    expect(JSON.stringify(created.game_data)).not.toContain('Secret Name')

    const snapshot = {
      teams: [{ id: 'home', name: 'Team' }, { id: 'away', name: 'Opponent' }],
      players: [{ id: localId, teamId: 'home', jerseyNumber: '12', isCoach: false, name: 'Secret Name' }],
      actions: [{ id: 'a', teamId: 'home', playerId: localId, type: 'score', value: 2, createdAt: 1, name: 'Secret Name' }],
      matchDate: null,
      catalogTeamId: 'x12-1',
    }
    await db.query('select public.save_match_scorer_snapshot($1, 1, 0, $2)', [created.match_id, snapshot])
    await db.query('select public.save_match_scorer_snapshot($1, 1, 0, $2)', [created.match_id, snapshot])
    await expect(db.query('select public.save_match_scorer_snapshot($1, 2, 0, $2)', [created.match_id, snapshot])).rejects.toThrow('another device')
    await expect(db.query('select public.save_match_scorer_snapshot($1, 2, 1, $2)', [
      created.match_id, { ...snapshot, catalogTeamId: 'x12-2' },
    ])).rejects.toThrow('team cannot change')
    await expect(db.query("select public.statistics_finish_match($1, 'x12-2', $2)", [created.match_id, viewer]))
      .rejects.toThrow('team does not match')
    await db.query("select public.statistics_finish_match($1, 'x12-1', $2)", [created.match_id, viewer])
    await db.query("select public.statistics_link_player('x12-1', $1, $2, $3, $4)", [created.match_id, viewer, localId, privatePlayer.id])

    const corrected = { ...snapshot, actions: [{ ...snapshot.actions[0], value: 3 }] }
    await db.query('select public.save_match_scorer_snapshot($1, 2, 1, $2)', [created.match_id, corrected])
    const history = (await db.query<{ history: { snapshot: { actions: { value: number }[] }; links: Record<string, string> }[] }>(
      "select public.statistics_history('x12-1') history",
    )).rows[0].history
    expect(history[0].snapshot.actions[0].value).toBe(3)
    expect(history[0].links[localId]).toBe(privatePlayer.id)
    expect(JSON.stringify(history)).not.toContain('Secret Name')

    await asUser(outsider)
    await expect(db.query('select public.match_select_official_scorer($1, $2)', [created.match_id, viewer])).rejects.toThrow('Match membership')
    await db.query("select public.join_shared_match($1, 'Other scorer')", [created.join_code])
    await expect(db.query('select * from public.match_scorer_snapshots')).rejects.toThrow('permission denied')
    await expect(db.query("select public.statistics_link_player('x12-1', $1, $2, $3, $4)", [
      created.match_id, viewer, localId, privatePlayer.id,
    ])).rejects.toThrow('Team access')
    await db.query('select public.save_match_scorer_snapshot($1, 1, 0, $2)', [created.match_id, snapshot])
    await db.query('select public.match_select_official_scorer($1, $2)', [created.match_id, outsider])
    await expect(db.query("select public.statistics_history('x12-1')")).rejects.toThrow('No access')
    await asUser(viewer)
    const changed = (await db.query<{ history: { trackerId: string }[] }>(
      "select public.statistics_history('x12-1') history",
    )).rows[0].history
    expect(changed[0].trackerId).toBe(outsider)
  }, 30_000)

  it('enforces session timing and close permissions on both joining paths', async () => {
    await asUser(coach)
    const game = { teams: [{ id: 'home', name: 'Team', color: '#000000' }, { id: 'away', name: 'Opponent', color: '#000000' }], players: [], catalogTeamId: 'x12-1' }
    const created = (await db.query<{ result: { match_id: string; join_code: string } }>(
      "select public.create_match_session($1 || jsonb_build_object('matchInfo', jsonb_build_object('startsAt', now() + interval '16 minutes')), 'Coach', now() + interval '16 minutes') result", [game],
    )).rows[0].result
    await asUser(viewer)
    await expect(db.query("select public.join_match_session($1, 'Viewer')", [created.match_id])).rejects.toThrow('not opened')
    await expect(db.query("select public.join_shared_match($1, 'Viewer')", [created.join_code])).rejects.toThrow('not opened')
    await expect(db.query('select public.close_match_session($1)', [created.match_id])).rejects.toThrow('creator or a team coach')
    await db.exec(`reset role; update public.shared_matches set session_starts_at = now() + interval '10 minutes' where id = '${created.match_id}';`)
    await asUser(viewer)
    await db.query("select public.join_match_session($1, 'Viewer')", [created.match_id])
    await expect(db.query('select public.set_live_match_tracker($1, $2)', [created.match_id, viewer]))
      .rejects.toThrow('creator or a team coach')
    await asUser(coach)
    await db.query('select public.set_live_match_tracker($1, $2)', [created.match_id, viewer])
    const scorers = (await db.query<{ result: { liveTrackerId: string; canManageLive: boolean } }>(
      'select public.match_scorers($1) result', [created.match_id],
    )).rows[0].result
    expect(scorers.liveTrackerId).toBe(viewer)
    expect(scorers.canManageLive).toBe(true)
    await db.query('select public.close_match_session($1)', [created.match_id])
    await asUser(outsider)
    await expect(db.query("select public.join_match_session($1, 'Outsider')", [created.match_id])).rejects.toThrow('closed')
    await db.exec(`reset role; update public.shared_matches set session_close_requested_at = now() - interval '11 minutes' where id = '${created.match_id}';`)
    await asUser(outsider)
    await expect(db.query("select public.join_match_session($1, 'Outsider')", [created.match_id])).rejects.toThrow('Session is closed')

    await asUser(coach)
    const expired = (await db.query<{ result: { match_id: string } }>(
      "select public.create_match_session($1 || jsonb_build_object('matchInfo', jsonb_build_object('startsAt', now() - interval '180 minutes')), 'Coach', now() - interval '180 minutes') result", [game],
    )).rows[0].result
    await asUser(outsider)
    await expect(db.query("select public.join_match_session($1, 'Outsider')", [expired.match_id])).rejects.toThrow('closed')
    const sessions = (await db.query<{ result: { id: string }[] }>('select public.list_match_sessions(false) result')).rows[0].result
    expect(sessions.map((session) => session.id)).not.toContain(expired.match_id)
  })

  it('accepts a matching offline game after closure exactly once and swaps team sides', async () => {
    const starts = '2026-11-13T12:00:00Z'
    const localId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const source = {
      teams: [{ id: 'home', name: 'Team A', color: '#000000' }, { id: 'away', name: 'Team B', color: '#000000' }],
      players: [], actions: [], matchInfo: { id: 'manual-source', date: '2026-11-13', startTime: '12:00', venue: '', startsAt: starts },
    }
    await asUser(coach)
    const created = (await db.query<{ result: { match_id: string } }>(
      'select public.create_match_session($1, $2, $3) result', [source, 'Coach', starts],
    )).rows[0].result
    await db.query('select public.close_match_session($1)', [created.match_id])
    const local = {
      teams: [{ id: 'home', name: 'Team B' }, { id: 'away', name: 'Team A' }],
      players: [{ id: 'home-1', name: 'Private', jerseyNumber: '12', statisticsPrivate: true }],
      actions: [{ id: 'score-1', playerId: 'home-1', teamId: 'home', type: 'score', value: 2, createdAt: 1 }],
      matchInfo: { id: 'manual-local', date: '2026-11-13', startTime: '12:00', venue: '', startsAt: starts },
    }
    await asUser(viewer)
    await expect(db.query('select public.submit_offline_match($1, $2, $3, $4, $5)', [
      created.match_id, localId, local, '2026-11-13T12:01:00Z', 'Viewer',
    ])).rejects.toThrow('start metadata does not match')
    await expect(db.query('select public.submit_offline_match($1, $2, $3, $4, $5)', [
      created.match_id, localId,
      { ...local, actions: [{ ...local.actions[0], shotLocation: { area: 'opponent', x: 200, y: 1 } }] },
      starts, 'Viewer',
    ])).rejects.toThrow('Invalid local match actions')
    for (let i = 0; i < 2; i++) {
      await db.query('select public.submit_offline_match($1, $2, $3, $4, $5)', [
        created.match_id, localId, local, starts, 'Viewer',
      ])
    }
    const events = (await db.query<{ action_data: { teamId: string; playerId: string } }>(
      "select action_data from public.match_events where match_id = $1 and action_id = 'score-1'", [created.match_id],
    )).rows
    expect(events).toHaveLength(1)
    expect(events[0].action_data).toMatchObject({ teamId: 'away', playerId: 'away-1' })
    await expect(db.query('select public.submit_offline_match($1, $2, $3, $4, $5)', [
      created.match_id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', local, starts, 'Viewer',
    ])).rejects.toThrow('already has a registration')
    await db.exec('reset role')
    const saved = (await db.query<{ game_data: { players: { name: string }[] } }>(
      'select game_data from public.match_offline_submissions where local_id = $1', [localId],
    )).rows[0].game_data
    expect(saved.players[0].name).toBe('Speler 12')
  })

  it('accepts a rebound without a player and the extended turnover types', async () => {
    const starts = '2026-11-13T12:00:00Z'
    const localId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const game = {
      teams: [{ id: 'home', name: 'Team A', color: '#000000' }, { id: 'away', name: 'Team B', color: '#000000' }],
      players: [{ id: 'home-1', name: 'Player', teamId: 'home', jerseyNumber: '1' }],
      actions: [
        { id: 'miss-1', playerId: 'home-1', teamId: 'home', type: 'missed_shot', value: 2, createdAt: 1, groupId: 'group-1' },
        { id: 'rebound-1', playerId: null, teamId: 'away', type: 'defensive_rebound', value: 1, createdAt: 2, groupId: 'group-1' },
        { id: 'turnover-1', playerId: 'home-1', teamId: 'home', type: 'turnover', value: 1, createdAt: 3, turnoverType: 'carry' },
      ],
      matchInfo: { id: 'manual-local', date: '2026-11-13', startTime: '12:00', venue: '', startsAt: starts },
    }
    await asUser(coach)
    const matchId = (await db.query<{ result: { match_id: string } }>(
      'select public.submit_offline_match(null, $1, $2, $3, $4) result', [localId, game, starts, 'Coach'],
    )).rows[0].result.match_id
    const rebound = (await db.query<{ action_data: { playerId: string | null; type: string } }>(
      "select action_data from public.match_events where match_id = $1 and action_id = 'rebound-1'", [matchId],
    )).rows[0].action_data
    expect(rebound).toMatchObject({ playerId: null, type: 'defensive_rebound' })
    const turnover = (await db.query<{ action_data: { turnoverType: string } }>(
      "select action_data from public.match_events where match_id = $1 and action_id = 'turnover-1'", [matchId],
    )).rows[0].action_data
    expect(turnover).toMatchObject({ turnoverType: 'carry' })
  })

  it('creates an offline-only game exactly once with an official scorer snapshot', async () => {
    const starts = '2026-11-13T12:00:00Z'
    const localId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const game = {
      teams: [{ id: 'home', name: 'Team A', color: '#000000' }, { id: 'away', name: 'Team B', color: '#000000' }],
      players: [{ id: 'home-1', name: 'Player', teamId: 'home', jerseyNumber: '1' }],
      actions: [{ id: 'score-2', playerId: 'home-1', teamId: 'home', type: 'score', value: 2, createdAt: 1 }],
      matchInfo: { id: 'manual-local', date: '2026-11-13', startTime: '12:00', venue: '', startsAt: starts },
    }
    await asUser(coach)
    const submit = async () => (await db.query<{ result: { match_id: string } }>(
      'select public.submit_offline_match(null, $1, $2, $3, $4) result', [localId, game, starts, 'Coach'],
    )).rows[0].result.match_id
    const matchId = await submit()
    expect(await submit()).toBe(matchId)
    const snapshot = (await db.query<{ result: { snapshot: { actions: unknown[] } } }>(
      'select public.my_match_snapshot($1) result', [matchId],
    )).rows[0].result
    expect(snapshot.snapshot.actions).toHaveLength(1)
    const events = (await db.query<{ count: number }>(
      'select count(*)::integer count from public.match_events where match_id = $1', [matchId],
    )).rows[0].count
    expect(events).toBe(1)
  })

  it('marks a submitted practice game in the team statistics history', async () => {
    const starts = '2026-11-12T18:00:00Z'
    const game = {
      teams: [{ id: 'home', name: 'X12-1', color: '#000000' }, { id: 'away', name: 'M16-1', club: 'Vrienden', color: '#000000' }],
      players: [{ id: 'home-1', name: 'Player', teamId: 'home', jerseyNumber: '1' }, { id: 'away-1', name: 'Guest', teamId: 'away', jerseyNumber: '7' }],
      actions: [{ id: 'practice-score', playerId: 'home-1', teamId: 'home', type: 'score', value: 2, createdAt: 1 }],
      catalogTeamId: 'x12-1',
      matchInfo: { id: 'practice-1', date: '2026-11-12', startTime: '19:00', venue: '', startsAt: starts, kind: 'practice' },
    }
    await asUser(coach)
    const matchId = (await db.query<{ result: { match_id: string } }>(
      'select public.submit_offline_match(null, $1, $2, $3, $4) result',
      ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', game, starts, 'Coach'],
    )).rows[0].result.match_id
    await db.query("select public.statistics_finish_match($1, 'x12-1', $2)", [matchId, coach])
    const history = (await db.query<{ history: { id: string; practice: boolean; teamClubs: Record<string, string> }[] }>(
      "select public.statistics_history('x12-1') history",
    )).rows[0].history
    expect(history.find((item) => item.id === matchId)).toMatchObject({ practice: true, teamClubs: { away: 'Vrienden' } })
    expect(history.filter((item) => item.id !== matchId).every((item) => item.practice === false)).toBe(true)
  })

  it('exposes other scorers\' current events and score links with the official statistics history', async () => {
    const starts = new Date().toISOString()
    const game = {
      teams: [{ id: 'home', name: 'Team A', color: '#000000' }, { id: 'away', name: 'Team B', color: '#000000' }],
      players: [], actions: [], catalogTeamId: 'x12-1',
      matchInfo: { id: 'manual-contrib', date: '2026-11-13', startTime: '12:00', venue: '', startsAt: starts },
    }
    await asUser(coach)
    const matchId = (await db.query<{ result: { match_id: string } }>(
      'select public.create_match_session($1, $2, $3) result', [game, 'Coach', starts],
    )).rows[0].result.match_id
    await asUser(viewer)
    await db.query("select public.join_match_session($1, 'Viewer')", [matchId])
    const event = (id: string, type: string, action: Record<string, unknown>) => db.query(
      `insert into public.match_events (id, match_id, tracker_id, tracker_name, action_id, event_type, action_data, occurred_at)
       values (gen_random_uuid(), $1, auth.uid(), 'Viewer', $2, $3, $4, now())`, [matchId, id, type, action],
    )
    const score = { id: 'v-score', teamId: 'home', playerId: 'home-1', type: 'score', value: 2, createdAt: 1, groupId: 'g' }
    await event('v-score', 'action_added', score)
    await event('v-assist', 'action_added', { id: 'v-assist', teamId: 'home', playerId: 'home-2', type: 'assist', value: 1, createdAt: 1, groupId: 'g' })
    await event('v-removed', 'action_added', { ...score, id: 'v-removed' })
    await event('v-removed', 'action_removed', { ...score, id: 'v-removed' })
    await event('v-score', 'action_updated', { ...score, value: 3 })
    await asUser(coach)
    await db.query('select public.save_match_scorer_snapshot($1, 1, 0, $2)', [matchId, {
      teams: game.teams.map(({ id, name }) => ({ id, name })),
      players: [{ id: 'home-1', teamId: 'home', jerseyNumber: '1', isCoach: false, statisticsPrivate: false }],
      actions: [{ id: 'c-score', teamId: 'home', playerId: null, type: 'score', value: 3, createdAt: 1 }],
      matchDate: null, catalogTeamId: 'x12-1',
    }])
    await db.query("select public.statistics_finish_match($1, 'x12-1', $2)", [matchId, coach])
    await db.query("select public.set_match_score_link($1, $2, $3, 'v-score', 'separate', null)", [matchId, coach, viewer])
    const history = (await db.query<{ history: { id: string; contributions: { trackerName: string; actions: { id: string; value: number }[] }[]; scoreLinks: { mode: string }[] }[] }>(
      "select public.statistics_history('x12-1') history",
    )).rows[0].history.find((item) => item.id === matchId)!
    expect(history.contributions).toHaveLength(1)
    expect(history.contributions[0].trackerName).toBe('Viewer')
    expect(history.contributions[0].actions.map((action) => [action.id, action.value])).toEqual([['v-assist', 1], ['v-score', 3]])
    expect(history.scoreLinks).toEqual([{ contributorId: viewer, contributorActionId: 'v-score', mode: 'separate', sourceActionId: null }])
  }, 30_000)

  it('lets everyone read but nobody change the opponent team list', async () => {
    await db.exec("reset role; insert into public.opponent_teams (name, logo_file) values ('Apollo', 'APOLLO.png')")
    await db.exec('set role anon')
    expect((await db.query('select name, logo_file from public.opponent_teams order by name')).rows).toEqual(expect.arrayContaining([
      { name: 'Apollo', logo_file: 'APOLLO.png' }, { name: 'Rap Élan', logo_file: 'RAP ÉLAN.WEBP' }, { name: 'Sv Zoebas', logo_file: 'SV ZOEBAS.jpg' },
      { name: 'HARLEM GLOBETROTTERS', logo_file: 'HARLEM GLOBETROTTERS.png' }, { name: 'WASHINGTON GENERALS', logo_file: 'WASHINGTON GENERALS.png' },
    ]))
    await expect(db.query("insert into public.opponent_teams (name) values ('Hack')")).rejects.toThrow('permission denied')
    await db.exec('reset role')
    await expect(db.query("insert into public.opponent_teams (name) values (' APOLLO ')")).rejects.toThrow('duplicate key')
  })

  it('opens a scheduled session once, walks the status lifecycle and locks writes outside review', async () => {
    await db.exec(`reset role; insert into public.zoebas_schedule (id, kind, match_date, start_time, home_team, away_team)
      values ('status-game', 'program', (now() at time zone 'Europe/Amsterdam')::date,
        ((now() at time zone 'Europe/Amsterdam') + interval '5 minutes')::time, 'X12-1', 'Opponent');`)
    const gameData = { teams: [{ id: 'home', name: 'X12-1', color: '#000000' }, { id: 'away', name: 'Opponent', color: '#000000' }], players: [], catalogTeamId: 'x12-1' }
    const statusOf = async (id: string) => (await db.query<{ status: string }>(
      'select s->>\'status\' status from jsonb_array_elements(public.list_match_sessions(true)) s where s->>\'id\' = $1', [id],
    )).rows[0]?.status

    await asUser(coach)
    const opened = (await db.query<{ result: { match_id: string } }>(
      "select public.open_schedule_session('status-game', $1, 'Coach') result", [gameData],
    )).rows[0].result
    const again = (await db.query<{ result: { match_id: string } }>(
      "select public.open_schedule_session('status-game', $1, 'Coach') result", [gameData],
    )).rows[0].result
    expect(again.match_id).toBe(opened.match_id)
    await expect(db.query("select public.open_schedule_session('status-game', $1, 'Coach')", [{ ...gameData, teams: [gameData.teams[1], gameData.teams[0]] }])).rejects.toThrow('do not match')
    expect(await statusOf(opened.match_id)).toBe('open')

    await db.exec(`reset role; update public.shared_matches set session_starts_at = now() - interval '1 minute' where id = '${opened.match_id}';`)
    expect(await statusOf(opened.match_id)).toBe('live')

    await asUser(viewer)
    await db.query("select public.join_match_session($1, 'Viewer')", [opened.match_id])
    const insertEvent = `insert into public.match_events (id, match_id, tracker_id, tracker_name, action_id, event_type, action_data, occurred_at)
      values (gen_random_uuid(), '${opened.match_id}', '${viewer}', 'Viewer', gen_random_uuid()::text, 'action_added', '{}', now())`
    await db.exec(insertEvent)

    await asUser(coach)
    await db.query('select public.close_match_session($1)', [opened.match_id])
    expect(await statusOf(opened.match_id)).toBe('closed')
    await asUser(viewer)
    await expect(db.exec(insertEvent)).rejects.toThrow('Session is locked')
    await expect(db.query("select public.join_match_session($1, 'Late')", [opened.match_id])).rejects.toThrow('closed')

    await db.exec(`reset role; update public.shared_matches set session_close_requested_at = now() - interval '11 minutes' where id = '${opened.match_id}';`)
    expect(await statusOf(opened.match_id)).toBe('in_review')
    await asUser(viewer)
    await expect(db.exec(insertEvent)).rejects.toThrow('Session is locked')
    await asUser(coach)
    await db.exec(insertEvent.replace(`'${viewer}', 'Viewer'`, `'${coach}', 'Coach'`))
    await asUser(viewer)
    await expect(db.query('select public.set_session_final($1)', [opened.match_id])).rejects.toThrow('team coach')
    await asUser(coach)
    await db.query('select public.set_session_final($1)', [opened.match_id])
    expect(await statusOf(opened.match_id)).toBe('final')
    await expect(db.exec(insertEvent.replace(`'${viewer}', 'Viewer'`, `'${coach}', 'Coach'`))).rejects.toThrow('Session is locked')
  })

  it('closes automatically after 30 minutes without events and moves to review after the closed window', async () => {
    await asUser(coach)
    const gameData = { teams: [{ id: 'home', name: 'X12-1', color: '#000000' }, { id: 'away', name: 'Opponent', color: '#000000' }], players: [], catalogTeamId: 'x12-1' }
    const started = (await db.query<{ result: { match_id: string } }>(
      "select public.create_match_session($1 || jsonb_build_object('matchInfo', jsonb_build_object('startsAt', now() - interval '35 minutes')), 'Coach', now() - interval '35 minutes') result", [gameData],
    )).rows[0].result
    const statusOf = async () => (await db.query<{ status: string }>(
      "select s->>'status' status from jsonb_array_elements(public.list_match_sessions(true)) s where s->>'id' = $1", [started.match_id],
    )).rows[0].status
    expect(await statusOf()).toBe('closed')
    await db.exec(`reset role; update public.shared_matches set session_starts_at = now() - interval '45 minutes' where id = '${started.match_id}';`)
    expect(await statusOf()).toBe('in_review')
  })

  it('restricts the admin dashboard to platform admins and coach changes to managers', async () => {
    const newCoach = '44444444-4444-4444-8444-444444444444'
    await db.exec(`alter table auth.users add column if not exists email text;
      update auth.users set email = 'coach@test.dev' where id = '${coach}';
      insert into auth.users (id, is_anonymous, email) values ('${newCoach}', false, 'new@test.dev');
      insert into public.platform_admins values ('${outsider}');`)

    await asUser(coach)
    await expect(db.query('select public.admin_dashboard()')).rejects.toThrow('Platform admin access required')
    await expect(db.query("select public.set_team_coach('x12-1', 'new@test.dev', array['finalise_review'])")).rejects.toThrow('Team manager access required')

    await asUser(viewer)
    await expect(db.query("select public.set_team_coach('x12-1', 'new@test.dev', array['finalise_review'])")).rejects.toThrow('Team manager access required')

    await asUser(outsider)
    const dashboard = JSON.stringify((await db.query<{ result: unknown }>('select public.admin_dashboard() result')).rows[0].result)
    expect(dashboard).toContain('coach@test.dev')
    await db.query("select public.set_team_coach('x12-1', 'coach@test.dev', array['finalise_review', 'manage_coaches'])")

    await asUser(coach)
    await db.query("select public.set_team_coach('x12-1', 'new@test.dev', array['finalise_review'])")
    await expect(db.query("select public.set_team_coach('x12-1', 'new@test.dev', array['manage_coaches'])")).rejects.toThrow('Only platform admins')
    await expect(db.query("select public.set_team_coach('x12-1', 'nobody@test.dev', array['finalise_review'])")).rejects.toThrow('No account')
    await db.query('select public.remove_team_coach($1, $2)', ['x12-1', newCoach])
    await db.exec('reset role')
    const remaining = (await db.query<{ count: number }>(
      'select count(*)::integer count from public.statistics_coaches where team_id = $1 and user_id = $2', ['x12-1', newCoach],
    )).rows[0].count
    expect(remaining).toBe(0)
  })

  it('refreshes the test games: one upcoming game tomorrow, one game today not yet started and one live game with events', async () => {
    await db.exec('reset role; select public.refresh_test_games();')
    const upcoming = (await db.query<{ days: number }>(
      "select (match_date - (now() at time zone 'Europe/Amsterdam')::date)::integer days from public.zoebas_schedule where id = 'test-game-upcoming'",
    )).rows[0]
    expect(upcoming.days).toBe(1)
    const today = (await db.query<{ future: boolean }>(
      "select (match_date + start_time) > (now() at time zone 'Europe/Amsterdam') future from public.zoebas_schedule where id = 'test-game-today'",
    )).rows[0]
    expect(today.future).toBe(true)
    const live = (await db.query<{ id: string; status: string; events: number }>(
      `select m.id, public.session_status(m.id) status,
        (select count(*)::integer from public.match_events e where e.match_id = m.id) events
       from public.shared_matches m where m.schedule_game_id = 'test-game-live'`,
    )).rows[0]
    expect(live.status).toBe('live')
    expect(live.events).toBe(4)
    await db.exec('select public.refresh_test_games();')
    const afterRerun = (await db.query<{ events: number }>(
      "select count(*)::integer events from public.match_events e join public.shared_matches m on m.id = e.match_id where m.schedule_game_id = 'test-game-live'",
    )).rows[0].events
    expect(afterRerun).toBe(4)
  })

  it('reports the live score of the test live game from the scorer snapshot', async () => {
    await db.exec('reset role; select public.refresh_test_games(); select public.refresh_test_live_snapshot();')
    const session = (await db.query<{ home: number; away: number }>(
      `select (s->>'homeScore')::integer home, (s->>'awayScore')::integer away
       from jsonb_array_elements(public.list_match_sessions(false)) s where s->>'scheduleId' = 'test-game-live'`,
    )).rows[0]
    expect(session).toEqual({ home: 5, away: 2 })
  })

  it('adds a finished test game with full statistics to the team history', async () => {
    await db.exec('reset role; select public.refresh_test_history();')
    await asUser(coach)
    const history = (await db.query<{ result: { id: string; snapshot: { actions: { type: string; value: number; teamId: string }[] } }[] }>(
      "select public.statistics_history('x12-1') result",
    )).rows[0].result
    const game = history.find((item) => (item.snapshot as { teams: { name: string }[] }).teams[0]?.name === 'Harlem Globetrotters' && item.snapshot.actions.length > 0)
    expect(game).toBeDefined()
    const points = (teamId: string) => game!.snapshot.actions
      .filter((action) => action.type === 'score' && action.teamId === teamId)
      .reduce((sum, action) => sum + action.value, 0)
    expect(points('home')).toBe(64)
    expect(points('away')).toBe(58)
    const withStats = (await db.query<{ id: string }>('select scheduled_games_with_stats as id from public.scheduled_games_with_stats()')).rows.map((row) => row.id)
    expect(withStats).toContain('test-game-history')
  })
})
