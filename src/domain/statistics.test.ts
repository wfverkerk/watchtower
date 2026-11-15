import { describe, expect, it } from 'vitest'
import { calculatePlayerStats, matchPlayerId, sumPlayerStats } from './statistics'
import type { GameAction } from './game'
import type { StatisticsPlayer } from '../services/statistics'

describe('player statistics', () => {
  it('counts points, all rebound types and shot outcomes without counting other players', () => {
    const action = (type: GameAction['type'], value = 1, playerId = 'a'): GameAction =>
      ({ id: crypto.randomUUID(), teamId: 'home', playerId, type, value, createdAt: 1 })
    const stats = calculatePlayerStats([
      action('score', 3), action('score', 1), action('missed_shot', 2),
      action('rebound'), action('offensive_rebound'), action('defensive_rebound'),
      action('assist'), action('score', 2, 'b'),
    ], 'a')
    expect(stats).toMatchObject({ points: 4, rebounds: 3, assists: 1, madeShots: 2, missedShots: 1 })
    expect(sumPlayerStats([stats, stats]).points).toBe(8)
  })

  it('uses stable player IDs or explicit links, never names or jersey numbers', () => {
    const roster: StatisticsPlayer[] = [
      { id: 'one', name: 'Sam', jerseyNumber: '4', isPrivate: false },
      { id: 'two', name: 'Sam', jerseyNumber: '4', isPrivate: false },
    ]
    const match = { links: { old: 'one' } }
    expect(matchPlayerId(match, 'old', roster)).toBe('one')
    expect(matchPlayerId(match, 'home-one', roster)).toBeNull()
    expect(matchPlayerId(match, 'home-two', roster)).toBe('two')
    expect(matchPlayerId(match, 'Sam', roster)).toBeNull()
  })
})
