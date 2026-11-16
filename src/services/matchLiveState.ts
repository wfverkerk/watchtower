import type { GameState } from '../domain/game'
import { isRecord } from '../domain/guards'
import { parseMatchTimeline, type MatchTimelineEvent } from '../domain/matchTimeline'
import { callRpc } from './supabaseRpc'

// What a viewer needs besides the events: the roster, who is on court, the period and the substitution timeline.
export type LiveStatePlayer = { id: string; name: string; jerseyNumber: string; isOnCourt: boolean }
export type LiveState = {
  teamId: string
  period: number
  youth: boolean
  gameStarted: boolean
  players: LiveStatePlayer[]
  timeline: MatchTimelineEvent[]
}

// The server accepts at most 64 KB; keep some room and drop the oldest timeline entries first.
const maxStateLength = 60_000

export function buildLiveState(game: GameState): LiveState {
  const own = game.teams[0]
  const state: LiveState = {
    teamId: own.id,
    period: game.period ?? 0,
    youth: game.youth ?? false,
    gameStarted: game.gameStarted,
    players: game.players
      .filter((player) => player.teamId === own.id && player.isParticipating !== false)
      .map(({ id, name, jerseyNumber, isOnCourt }) => ({ id, name, jerseyNumber, isOnCourt })),
    timeline: (game.timeline ?? []).map((event) => JSON.parse(JSON.stringify(event)) as MatchTimelineEvent),
  }
  while (state.timeline.length > 0 && JSON.stringify(state).length > maxStateLength) state.timeline.shift()
  return state
}

export function parseLiveState(value: unknown): LiveState | null {
  if (!isRecord(value) || typeof value.teamId !== 'string' || typeof value.period !== 'number'
    || !Number.isFinite(value.period) || typeof value.youth !== 'boolean' || typeof value.gameStarted !== 'boolean'
    || !Array.isArray(value.players) || !Array.isArray(value.timeline)) return null
  const players: LiveStatePlayer[] = []
  for (const player of value.players) {
    if (!isRecord(player) || typeof player.id !== 'string' || typeof player.name !== 'string'
      || typeof player.jerseyNumber !== 'string' || typeof player.isOnCourt !== 'boolean') return null
    players.push({ id: player.id, name: player.name, jerseyNumber: player.jerseyNumber, isOnCourt: player.isOnCourt })
  }
  try {
    return {
      teamId: value.teamId, period: value.period, youth: value.youth, gameStarted: value.gameStarted,
      players, timeline: parseMatchTimeline(value.timeline),
    }
  } catch {
    return null
  }
}

export async function uploadLiveState(matchId: string, state: LiveState) {
  await callRpc('set_match_live_state', { p_match_id: matchId, p_state: state })
}
