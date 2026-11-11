import { describe, expect, it } from 'vitest'
import { canStartGame, createInitialGameState, parseGameState, startNextPeriod } from '../domain/game'
import { applyGameRoster, createGameRosterDraft } from './gameRoster'
import type { TeamProfile } from './teamProfiles'

function profile(): TeamProfile {
  return {
    id: 'team',
    name: 'Thuis',
    players: [
      { id: '1', name: 'Oud', jerseyNumber: '1', isParticipating: true, isOnCourt: false },
      { id: '6', name: 'Reserve', jerseyNumber: '6', isParticipating: false, isOnCourt: false },
    ],
    coaches: [],
  }
}

describe('game roster editing', () => {
  it('preserves actions and player identities when a player becomes absent', () => {
    const game = createInitialGameState()
    game.actions.push({ id: 'score', teamId: 'home', playerId: 'home-1', type: 'score', value: 2, createdAt: 1 })
    const draft = createGameRosterDraft(game, profile())
    const player = draft.players.find((item) => item.id === '1')!
    player.isParticipating = false
    player.name = ''
    const reserve = draft.players.find((item) => item.id === '6')!
    reserve.isParticipating = true
    game.players = applyGameRoster(game, draft)

    expect(game.players.find((item) => item.id === 'home-1')).toMatchObject({
      name: 'Speler 1', isParticipating: false, isOnCourt: false,
    })
    expect(game.players.find((item) => item.id === 'home-6')).toMatchObject({
      name: 'Reserve', isParticipating: true, isOnCourt: false,
    })
    expect(game.actions[0].playerId).toBe('home-1')
    const restored = parseGameState(JSON.parse(JSON.stringify(game)))
    expect(restored.players.find((item) => item.id === 'home-1')?.isParticipating).toBe(false)
    expect(startNextPeriod(restored, ['home-1', 'home-2'])).toBe(false)
    expect(canStartGame(restored)).toBe(true)
    expect(createGameRosterDraft(restored, draft).players.find((item) => item.id === '1')?.isParticipating).toBe(false)
  })

  it('preserves existing non-prefixed player and coach ids', () => {
    const game = createInitialGameState()
    game.players.push({ id: 'custom', name: 'Coach', teamId: 'home', jerseyNumber: '', isOnCourt: false, isCoach: true, coachRole: 'assistant' })
    const draft = createGameRosterDraft(game, profile())
    const coach = draft.coaches.find((item) => item.id === 'custom')!
    coach.isParticipating = false
    const players = applyGameRoster(game, draft)
    expect(players.filter((item) => item.id === 'custom')).toHaveLength(1)
    expect(players.find((item) => item.id === 'custom')).toMatchObject({ isCoach: true, isParticipating: false })
  })

  it('does not duplicate migrated players stored with and without a team prefix', () => {
    const game = createInitialGameState()
    const roster = profile()
    roster.players.unshift({ id: 'home-1', name: 'Speler 1', jerseyNumber: '1', isParticipating: true, isOnCourt: true })
    const draft = createGameRosterDraft(game, roster)
    expect(draft.players.filter((player) => player.jerseyNumber === '1')).toHaveLength(1)
  })
})
