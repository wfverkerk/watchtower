import { describe, expect, it } from 'vitest'
import {
  canStartGame,
  createInitialGameState,
  getRecentActions,
  getScore,
  getTeamStats,
  parseGameState,
  undoLastAction,
  updateScoringPlay,
  type GameAction,
} from './game'
import { gameStorageKey, loadGameState, saveGameState } from '../services/gameStorage'

function makeAction(overrides: Partial<GameAction> & Pick<GameAction, 'type' | 'teamId' | 'playerId'>): GameAction {
  return {
    id: 'action-1',
    value: 1,
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('game domain rules', () => {
  it('calculates team scores and statistics from recorded actions', () => {
    const game = createInitialGameState()
    game.actions = [
      makeAction({ id: 'score-1', playerId: 'home-1', teamId: 'home', type: 'score', value: 3 }),
      makeAction({ id: 'miss-1', playerId: 'home-2', teamId: 'home', type: 'missed_shot', value: 2 }),
      makeAction({ id: 'rebound-1', playerId: 'home-3', teamId: 'home', type: 'offensive_rebound' }),
      makeAction({ id: 'assist-1', playerId: 'away-1', teamId: 'away', type: 'assist' }),
    ]

    expect(getScore(game).map(({ id, points }) => [id, points])).toEqual([
      ['home', 3],
      ['away', 0],
    ])
    expect(getTeamStats(game)).toMatchObject([
      { teamId: 'home', offensiveRebounds: 1, missedShots: 1 },
      { teamId: 'away', assists: 1 },
    ])
  })

  it('stores a made basket and its assist as a linked play', () => {
    const actions = updateScoringPlay([], {
      teamId: 'home',
      scorerId: 'home-1',
      value: 3,
      assistPlayerId: 'home-2',
      createdAt: 50,
      createId: (() => {
        let id = 0
        return () => `new-${++id}`
      })(),
    })

    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({ type: 'score', playerId: 'home-1', value: 3, groupId: 'new-1' })
    expect(actions[1]).toMatchObject({ type: 'assist', playerId: 'home-2', groupId: 'new-1' })

    const game = { ...createInitialGameState(), actions }
    expect(getRecentActions(game)).toEqual([{ action: actions[0], assistName: 'Speler 2' }])
    expect(getTeamStats(game)[0].assists).toBe(1)
  })

  it('updates scorer and assist together, and can remove the assist', () => {
    const actions = [
      makeAction({ id: 'score', type: 'score', teamId: 'home', playerId: 'home-1', value: 2, groupId: 'play' }),
      makeAction({ id: 'assist', type: 'assist', teamId: 'home', playerId: 'home-2', groupId: 'play' }),
    ]
    const updated = updateScoringPlay(actions, {
      actionId: 'score',
      teamId: 'home',
      scorerId: 'home-3',
      value: 3,
      assistPlayerId: 'home-4',
      createdAt: 60,
      createId: () => 'unused',
    })
    expect(updated).toMatchObject([
      { id: 'score', playerId: 'home-3', value: 3, groupId: 'play' },
      { id: 'assist', playerId: 'home-4', groupId: 'play' },
    ])

    const withoutAssist = updateScoringPlay(updated, {
      actionId: 'score',
      teamId: 'home',
      scorerId: 'home-3',
      value: 3,
      assistPlayerId: null,
      createdAt: 70,
      createId: () => 'unused',
    })
    expect(withoutAssist).toEqual([
      expect.objectContaining({ id: 'score', playerId: 'home-3', value: 3 }),
    ])
    expect(withoutAssist[0]).not.toHaveProperty('groupId')
  })

  it('undoes a linked score-and-assist play as one action', () => {
    const actions = [
      makeAction({ id: 'prior', type: 'foul', teamId: 'home', playerId: 'home-1' }),
      makeAction({ id: 'score', type: 'score', teamId: 'home', playerId: 'home-1', groupId: 'play' }),
      makeAction({ id: 'assist', type: 'assist', teamId: 'home', playerId: 'home-2', groupId: 'play' }),
    ]

    expect(undoLastAction(actions).map((action) => action.id)).toEqual(['prior'])
    expect(undoLastAction([])).toEqual([])
  })

  it('requires exactly five active players per team to start', () => {
    const game = createInitialGameState()
    expect(canStartGame(game)).toBe(true)
    game.players[0].isOnCourt = false
    expect(canStartGame(game)).toBe(false)
  })

  it('normalizes older saved rosters and rejects malformed game data', () => {
    const legacy = createInitialGameState()
    const oldState = {
      ...legacy,
      players: legacy.players.map(({ isOnCourt: _isOnCourt, jerseyNumber: _number, ...player }) => player),
    }

    expect(parseGameState(oldState).players.filter((player) => player.isOnCourt)).toHaveLength(10)
    expect(() => parseGameState({ ...oldState, teams: [] })).toThrow('precies twee')
  })

  it('loads and saves the existing local-storage key without dropping game data', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const game = createInitialGameState()
    game.gameStarted = true
    game.actions.push(makeAction({ type: 'score', teamId: 'home', playerId: 'home-1', value: 2 }))

    saveGameState(game, storage)

    expect(gameStorageKey).toBe('watchtower-game-v1')
    expect(loadGameState(storage)).toEqual(game)
  })
})
