import { describe, expect, it, vi } from 'vitest'
import { loadStatisticsHistory } from './statistics'
import { callRpc } from './supabaseRpc'

vi.mock('./supabaseRpc', () => ({ callRpc: vi.fn() }))

const snapshot = {
  teams: [{ id: 'home', name: 'Team A' }, { id: 'away', name: 'Team B' }],
  players: ['home-1', 'away-1', 'away-2'].map((id) => ({ id, teamId: id.split('-')[0], jerseyNumber: id.slice(-1), isCoach: false, statisticsPrivate: false })),
  actions: [{ id: 's1', teamId: 'away', playerId: null, type: 'score', value: 2, period: 1, createdAt: 1000 }],
  matchDate: null,
}

function match(extra: Record<string, unknown>) {
  return {
    id: 'match', finishedAt: '2026-11-13T13:00:00Z', trackerId: 'official', snapshot,
    snapshotUpdatedAt: '2026-11-13T13:00:00Z', canEdit: false, links: {}, ...extra,
  }
}

describe('statistics history', () => {
  it('anchors on the official score and adds supplements from other scorers', async () => {
    vi.mocked(callRpc).mockResolvedValue([match({
      contributions: [{ trackerId: 'other', trackerName: 'Other', actions: [
        { id: 'o1', teamId: 'away', playerId: 'away-1', type: 'score', value: 2, period: 1, createdAt: 1001, groupId: 'g', shotLocation: { area: 'own' } },
        { id: 'a1', teamId: 'away', playerId: 'away-2', type: 'assist', value: 1, createdAt: 1001, groupId: 'g' },
        { id: 'o2', teamId: 'away', playerId: 'away-1', type: 'score', value: 3, period: 1, createdAt: 9000 },
      ] }],
      scoreLinks: [],
    })])
    const [history] = await loadStatisticsHistory('x12-1')
    expect(history.game.actions.map((action) => [action.type, action.value, action.playerId])).toEqual([
      ['score', 2, 'away-1'], ['assist', 1, 'away-2'],
    ])
  })

  it('keeps older responses without contributions unchanged and rejects malformed contributions', async () => {
    vi.mocked(callRpc).mockResolvedValue([match({})])
    expect((await loadStatisticsHistory('x12-1'))[0].game.actions).toHaveLength(1)
    vi.mocked(callRpc).mockResolvedValue([match({ contributions: [{ trackerId: 'other', actions: [] }] })])
    await expect(loadStatisticsHistory('x12-1')).rejects.toThrow('Invalid statistics contribution')
  })
})
