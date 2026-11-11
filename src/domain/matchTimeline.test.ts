import { describe, expect, it } from 'vitest'
import { createInitialGameState, parseGameState } from './game'
import { lineupChanges, parseMatchTimeline } from './matchTimeline'

describe('match timeline', () => {
  it('records only changes with player snapshots in both directions', () => {
    const players = createInitialGameState().players.slice(0, 3)
    players[2].isOnCourt = false
    const changes = lineupChanges(players, [players[1].id, players[2].id])
    expect(changes.out).toEqual([{ id: players[0].id, name: players[0].name, jerseyNumber: '1' }])
    expect(changes.in).toEqual([{ id: players[2].id, name: players[2].name, jerseyNumber: '3' }])
    players[0].name = 'Changed'
    expect(changes.out[0].name).toBe('Speler 1')
    expect(lineupChanges(players, [players[0].id, players[1].id])).toEqual({ out: [], in: [] })
  })

  it('round-trips period events and substitutions while accepting older saves', () => {
    const game = createInitialGameState()
    game.timeline = [
      { id: 'start', type: 'period_start', period: 1, createdAt: 1 },
      { id: 'sub', type: 'substitution', period: 1, createdAt: 2, out: [{ id: 'p', name: 'A', jerseyNumber: '4' }], in: [] },
      { id: 'end', type: 'period_end', period: 1, createdAt: 3 },
    ]
    expect(parseGameState(JSON.parse(JSON.stringify(game))).timeline).toEqual(game.timeline)
    expect(parseGameState(createInitialGameState()).timeline).toBeUndefined()
    expect(() => parseMatchTimeline([{ id: 'x', type: 'period_end', period: 0, createdAt: 1 }])).toThrow()
    expect(() => parseMatchTimeline([{ id: 'x', type: 'substitution', period: 1, createdAt: 1, out: [], in: [] }])).toThrow()
  })
})
