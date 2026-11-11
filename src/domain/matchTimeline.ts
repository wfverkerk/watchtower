import type { Player } from './game'

export type TimelinePlayer = { id: string; name: string; jerseyNumber: string }
export type MatchTimelineEvent =
  | { id: string; type: 'period_start' | 'period_end'; period: number; createdAt: number }
  | { id: string; type: 'substitution'; period: number; createdAt: number; out: TimelinePlayer[]; in: TimelinePlayer[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimelinePlayer(value: unknown): value is TimelinePlayer {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.jerseyNumber === 'string'
}

export function parseMatchTimeline(value: unknown): MatchTimelineEvent[] {
  if (!Array.isArray(value)) throw new Error('Opgeslagen wedstrijdverloop is ongeldig.')
  return value.map((event): MatchTimelineEvent => {
    if (!isRecord(event) || typeof event.id !== 'string'
      || typeof event.period !== 'number' || !Number.isSafeInteger(event.period) || event.period < 1
      || typeof event.createdAt !== 'number' || !Number.isFinite(event.createdAt)) {
      throw new Error('Opgeslagen wedstrijdverloop is ongeldig.')
    }
    const base = { id: event.id, period: event.period, createdAt: event.createdAt }
    if (event.type === 'period_start' || event.type === 'period_end') return { ...base, type: event.type }
    if (event.type === 'substitution' && Array.isArray(event.out) && event.out.every(isTimelinePlayer)
      && Array.isArray(event.in) && event.in.every(isTimelinePlayer) && event.out.length + event.in.length > 0) {
      return { ...base, type: 'substitution', out: event.out.map((player) => ({ ...player })), in: event.in.map((player) => ({ ...player })) }
    }
    throw new Error('Opgeslagen wedstrijdverloop is ongeldig.')
  })
}

export function lineupChanges(players: Player[], selectedIds: string[]) {
  const selected = new Set(selectedIds)
  const snapshot = (player: Player): TimelinePlayer => ({ id: player.id, name: player.name, jerseyNumber: player.jerseyNumber })
  return {
    out: players.filter((player) => player.isOnCourt && !selected.has(player.id)).map(snapshot),
    in: players.filter((player) => !player.isOnCourt && selected.has(player.id)).map(snapshot),
  }
}
