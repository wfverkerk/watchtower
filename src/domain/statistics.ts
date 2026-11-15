import type { GameAction } from './game'
import type { StatisticsMatch, StatisticsPlayer } from '../services/statistics'

export type PlayerStats = {
  points: number
  assists: number
  rebounds: number
  turnovers: number
  fouls: number
  blocks: number
  steals: number
  madeShots: number
  missedShots: number
}

export const statKeys = ['points', 'assists', 'rebounds', 'turnovers', 'fouls', 'blocks', 'steals', 'madeShots', 'missedShots'] as const
export type PlayerStatKey = typeof statKeys[number]

export function calculatePlayerStats(actions: GameAction[], playerId: string): PlayerStats {
  const stats: PlayerStats = { points: 0, assists: 0, rebounds: 0, turnovers: 0, fouls: 0, blocks: 0, steals: 0, madeShots: 0, missedShots: 0 }
  for (const action of actions) {
    if (action.playerId !== playerId) continue
    switch (action.type) {
      case 'score': stats.points += action.value; stats.madeShots++; break
      case 'assist': stats.assists++; break
      case 'rebound':
      case 'offensive_rebound':
      case 'defensive_rebound': stats.rebounds++; break
      case 'turnover': stats.turnovers++; break
      case 'foul': stats.fouls++; break
      case 'block': stats.blocks++; break
      case 'steal': stats.steals++; break
      case 'missed_shot': stats.missedShots++; break
    }
  }
  return stats
}

export function matchPlayerId(match: Pick<StatisticsMatch, 'links'>, localId: string, roster: StatisticsPlayer[]) {
  const explicit = match.links[localId]
  if (explicit) return explicit
  return roster.find((player) => localId === `home-${player.id}` && !Object.values(match.links).includes(player.id))?.id ?? null
}

export function playerMatchStats(match: StatisticsMatch, playerId: string, roster: StatisticsPlayer[]) {
  const localPlayer = match.game.players.find((player) =>
    player.teamId === match.game.teams[0].id
    && matchPlayerId(match, player.id, roster) === playerId)
  return localPlayer
    ? calculatePlayerStats(match.game.actions.filter((action) => action.teamId === match.game.teams[0].id), localPlayer.id)
    : null
}

export function sumPlayerStats(items: PlayerStats[]) {
  const total = calculatePlayerStats([], '')
  for (const item of items) for (const key of statKeys) total[key] += item[key]
  return total
}
