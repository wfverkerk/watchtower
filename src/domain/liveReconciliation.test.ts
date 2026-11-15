import { describe, expect, it } from 'vitest'
import { createInitialGameState, type GameAction } from './game'
import { enrichOfficialActions, reconcileLiveScores } from './liveReconciliation'
import type { LiveAction } from '../services/liveMatch'

function item(trackerId: string, action: Partial<GameAction> & Pick<GameAction, 'id' | 'createdAt'>): LiveAction {
  return {
    trackerId, trackerName: trackerId,
    action: { playerId: null, teamId: 'away', type: 'score', value: 1, period: 1, ...action },
  }
}

describe('live score reconciliation', () => {
  it('matches repeated free throws one-to-one and preserves the official score', () => {
    const game = createInitialGameState()
    const result = reconcileLiveScores(game, 'source', [
      item('source', { id: 's1', createdAt: 1000 }),
      item('source', { id: 's2', createdAt: 2000 }),
      item('other', { id: 'o1', createdAt: 1100, playerId: 'away-1' }),
      item('other', { id: 'o2', createdAt: 2100 }),
    ])
    expect(result.official).toHaveLength(2)
    expect(result.additional).toHaveLength(0)
    expect(result.official.map((entry) => entry.action.id)).toEqual(['s1', 's2'])
    expect(result.official[0].action.playerId).toBe('away-1')
    expect(result.official.every((entry) => entry.uncertain)).toBe(true)
  })

  it('keeps unmatched scores separate and adds an assist without changing points', () => {
    const game = createInitialGameState()
    const score = item('source', { id: 's1', createdAt: 1000, value: 2 })
    const other = item('other', { id: 'o1', createdAt: 1001, value: 2, groupId: 'group', shotLocation: { area: 'own' } })
    const assist = item('other', { id: 'a1', createdAt: 1001, type: 'assist', playerId: 'away-2', groupId: 'group' })
    const result = reconcileLiveScores(game, 'source', [score, other, assist, item('other', { id: 'o2', createdAt: 1200, value: 3 })])
    expect(result.official).toHaveLength(2)
    expect(result.official[0].action.shotLocation).toEqual({ area: 'own' })
    expect(result.official[1].action.type).toBe('assist')
    expect(result.additional.map((entry) => entry.action.id)).toEqual(['o2'])
  })

  it('respects manual links before automatic matches and reports stale links', () => {
    const game = createInitialGameState()
    const actions = [
      item('source', { id: 's1', createdAt: 1000 }),
      item('source', { id: 's2', createdAt: 2000 }),
      item('other', { id: 'auto', createdAt: 1001 }),
      item('other', { id: 'manual', createdAt: 2001 }),
    ]
    const link = { sourceId: 'source', contributorId: 'other', contributorActionId: 'manual', mode: 'linked' as const, sourceActionId: 's1' }
    const result = reconcileLiveScores(game, 'source', actions, [link])
    expect(result.official[0].uncertain).toBe(false)
    expect(result.official[1].uncertain).toBe(true)
    expect(result.additional).toHaveLength(0)
    const stale = reconcileLiveScores(game, 'source', actions, [{ ...link, sourceActionId: 'missing' }])
    expect(stale.invalidLinks.map((entry) => entry.action.id)).toEqual(['manual'])
  })

  it('marks a match with an unknown legacy period as uncertain', () => {
    const result = reconcileLiveScores(createInitialGameState(), 'source', [
      item('source', { id: 'legacy', createdAt: 1, period: undefined }),
      item('other', { id: 'new', createdAt: 2, period: 1 }),
    ])
    expect(result.official[0].uncertain).toBe(true)
    expect(result.additional).toHaveLength(0)
  })

  it('enriches official statistics without changing the score or counting contributors\' other actions twice', () => {
    const game = createInitialGameState()
    const official = { id: 's1', teamId: 'away', playerId: null, type: 'score' as const, value: 2, period: 1, createdAt: 1000 }
    const enriched = enrichOfficialActions({ ...game, actions: [official] }, 'source', [
      item('other', { id: 'o1', createdAt: 1001, value: 2, playerId: 'away-1', groupId: 'g', shotLocation: { area: 'own' } }),
      item('other', { id: 'a1', createdAt: 1001, type: 'assist', playerId: 'away-2', groupId: 'g' }),
      item('other', { id: 'r1', createdAt: 1002, type: 'rebound', playerId: 'away-1' }),
      item('other', { id: 'o2', createdAt: 5000, value: 3, playerId: 'away-1' }),
    ])
    expect(enriched.map((action) => action.type)).toEqual(['score', 'assist'])
    expect(enriched[0]).toMatchObject({ id: 's1', value: 2, playerId: 'away-1', shotLocation: { area: 'own' } })
    expect(official.playerId).toBeNull()
    expect(enrichOfficialActions({ ...game, actions: [official] }, 'source', [])).toEqual([official])
  })
})
