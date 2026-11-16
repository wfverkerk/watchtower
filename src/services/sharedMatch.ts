import type { GameState } from '../domain/game'
import type { MatchEvent, MatchLink } from './matchEventLog'
import type { MatchSnapshot } from './matchSnapshots'
import { callRpc } from './supabaseRpc'
import { ensureAnonymousUser, getSupabaseClient } from './supabaseClient'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The shared-match service returned invalid data.')
  }
  return value as Record<string, unknown>
}

function parseMatchResponse(value: unknown): { link: MatchLink; gameData: GameState } {
  const response = record(Array.isArray(value) ? value[0] : value)
  if (typeof response.match_id !== 'string'
    || typeof response.tracker_id !== 'string'
    || typeof response.display_name !== 'string'
    || typeof response.game_data !== 'object'
    || response.game_data === null) {
    throw new Error('The shared-match service returned incomplete data.')
  }
  return {
    link: {
      matchId: response.match_id,
      trackerId: response.tracker_id,
      displayName: response.display_name,
    } satisfies MatchLink,
    gameData: response.game_data as GameState,
  }
}

export type SessionStatus = 'open' | 'live' | 'closed' | 'in_review' | 'final'

export type MatchSession = {
  id: string
  scheduleId: string | null
  startsAt: string
  teams: { id: string; name: string; color: string }[]
  status: SessionStatus
  closed: boolean
  canClose: boolean
  canReview: boolean
  homeScore?: number
  awayScore?: number
}

const sessionStatuses: readonly string[] = ['open', 'live', 'closed', 'in_review', 'final']

export async function listMatchSessions(includeClosed = false): Promise<MatchSession[]> {
  const data = await callRpc('list_match_sessions', { p_include_closed: includeClosed })
  if (!Array.isArray(data)) throw new Error('Invalid session list.')
  return data.map((item: unknown) => {
    const session = record(item)
    if (typeof session.id !== 'string' || typeof session.startsAt !== 'string'
      || !Number.isFinite(Date.parse(session.startsAt)) || typeof session.closed !== 'boolean' || typeof session.canClose !== 'boolean'
      || typeof session.canReview !== 'boolean' || typeof session.status !== 'string' || !sessionStatuses.includes(session.status)
      || !Array.isArray(session.teams) || session.teams.length !== 2) throw new Error('Invalid session.')
    const teams = session.teams.map((item: unknown) => {
      const team = record(item)
      if (typeof team.id !== 'string' || typeof team.name !== 'string' || typeof team.color !== 'string') {
        throw new Error('Invalid session team.')
      }
      return { id: team.id, name: team.name, color: team.color }
    })
    return {
      id: session.id,
      scheduleId: typeof session.scheduleId === 'string' ? session.scheduleId : null,
      startsAt: session.startsAt,
      status: session.status as SessionStatus,
      closed: session.closed,
      canClose: session.canClose,
      canReview: session.canReview,
      homeScore: typeof session.homeScore === 'number' ? session.homeScore : 0,
      awayScore: typeof session.awayScore === 'number' ? session.awayScore : 0,
      teams,
    }
  })
}

export async function openScheduleSession(scheduleId: string, gameData: GameState, displayName: string) {
  const trackerId = await ensureAnonymousUser()
  const data = await callRpc('open_schedule_session', {
    p_schedule_id: scheduleId, p_game_data: gameData, p_display_name: displayName.trim(),
  })
  return parseMatchResponse({ ...record(data), tracker_id: trackerId, display_name: displayName.trim() })
}

export async function setSessionFinal(matchId: string) {
  await callRpc('set_session_final', { p_match_id: matchId })
}

export async function joinMatchSession(matchId: string, displayName: string) {
  const trackerId = await ensureAnonymousUser()
  const data = await callRpc('join_match_session', {
    p_match_id: matchId, p_display_name: displayName.trim(),
  })
  return parseMatchResponse({ ...record(data), tracker_id: trackerId, display_name: displayName.trim() })
}

export async function setLiveMatchTracker(matchId: string, trackerId: string) {
  await callRpc('set_live_match_tracker', { p_match_id: matchId, p_tracker_id: trackerId })
}

// Makes this device the scorer. The server refuses when taking over is not allowed, for example when the
// match already has several registrations.
export async function transferMatchScorer(matchId: string) {
  await callRpc('transfer_match_scorer', { p_match_id: matchId })
}

export async function loadSharedGame(matchId: string): Promise<GameState> {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  await ensureAnonymousUser()
  const { data, error } = await supabase.from('shared_matches').select('game_data').eq('id', matchId).single()
  if (error) throw new Error(error.message)
  const response = record(data)
  if (!response.game_data || typeof response.game_data !== 'object') throw new Error('Invalid shared match.')
  return response.game_data as GameState
}

export async function uploadMatchEvents(events: MatchEvent[]) {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  for (let offset = 0; offset < events.length; offset += 100) {
    const batch = events.slice(offset, offset + 100)
    const { error } = await supabase.from('match_events').upsert(
      batch.map((event) => ({
        id: event.id,
        match_id: event.matchId,
        tracker_id: event.trackerId,
        tracker_name: event.trackerName,
        action_id: event.actionId,
        event_type: event.type,
        action_data: event.action,
        occurred_at: new Date(event.occurredAt).toISOString(),
      })),
      { onConflict: 'id', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)
  }
}

export async function uploadMatchSnapshot(snapshot: MatchSnapshot) {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { matchId, revision, baseRevision, trackerId: _trackerId, ...data } = snapshot
  const { error } = await supabase.rpc('save_match_scorer_snapshot', {
    p_match_id: matchId,
    p_revision: revision,
    p_expected_revision: baseRevision,
    p_snapshot: data,
  })
  if (error) throw new Error(error.message)
}
