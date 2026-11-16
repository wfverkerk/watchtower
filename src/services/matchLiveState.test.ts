import { describe, expect, it } from 'vitest'
import { createInitialGameState } from '../domain/game'
import { buildLiveState, parseLiveState } from './matchLiveState'

describe('live state', () => {
  it('describes the roster, lineup, period and timeline of the own team', () => {
    const game = createInitialGameState()
    game.period = 2
    game.gameStarted = true
    game.players[0].isOnCourt = false
    game.players[1].isParticipating = false
    game.timeline = [{ id: 't1', type: 'period_start', period: 1, createdAt: 1 }]

    const state = buildLiveState(game)
    expect(state).toMatchObject({ teamId: 'home', period: 2, youth: false, gameStarted: true })
    expect(state.players.map((player) => player.id)).toEqual(['home-1', 'home-3', 'home-4', 'home-5'])
    expect(state.players[0]).toEqual({ id: 'home-1', name: 'Speler 1', jerseyNumber: '1', isOnCourt: false })
    expect(state.timeline).toEqual(game.timeline)
    expect(state.timeline).not.toBe(game.timeline)
  })

  it('round-trips through parsing and rejects invalid data', () => {
    const state = buildLiveState(createInitialGameState())
    expect(parseLiveState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(parseLiveState(null)).toBeNull()
    expect(parseLiveState({ ...state, players: [{ id: 'x' }] })).toBeNull()
    expect(parseLiveState({ ...state, timeline: [{ id: 't', type: 'unknown', period: 1, createdAt: 1 }] })).toBeNull()
  })

  it('drops the oldest timeline entries when the state grows too large', () => {
    const game = createInitialGameState()
    game.timeline = Array.from({ length: 400 }, (_, index) => ({
      id: `t${index}`, type: 'substitution' as const, period: 1, createdAt: index,
      out: [{ id: 'home-1', name: 'x'.repeat(200), jerseyNumber: '1' }],
      in: [{ id: 'home-2', name: 'y'.repeat(200), jerseyNumber: '2' }],
    }))
    const state = buildLiveState(game)
    expect(JSON.stringify(state).length).toBeLessThanOrEqual(60_000)
    expect(state.timeline.length).toBeLessThan(400)
    expect(state.timeline.at(-1)?.id).toBe('t399')
  })
})
