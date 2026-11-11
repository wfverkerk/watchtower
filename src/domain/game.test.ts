import { describe, expect, it } from 'vitest'
import {
  canStartGame,
  createInitialGameState,
  getRecentActions,
  getScore,
  getPlayerFouls,
  getPeriodTeamFouls,
  getTeamStats,
  parseGameState,
  startNextPeriod,
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
  it('stores unattributed opponent scores without inventing a player', () => {
    const game = createInitialGameState()
    game.actions = [1, 2, 3].map((value) => makeAction({
      id: `away-score-${value}`, type: 'score', teamId: 'away', playerId: null, value, period: 1,
    }))
    const restored = parseGameState(game)
    expect(restored.actions).toEqual(game.actions)
    expect(getScore(restored)[1].points).toBe(6)
    expect(getScore({ ...restored, actions: undoLastAction(restored.actions) })[1].points).toBe(3)
    expect(() => parseGameState({ ...game, actions: [{ ...game.actions[0], type: 'foul' }] })).toThrow()
    expect(() => parseGameState({ ...game, actions: [{ ...game.actions[0], teamId: 'home' }] })).toThrow()
  })

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
      shotLocation: { area: 'opponent', x: 25, y: 70 },
      createdAt: 50,
      createId: (() => {
        let id = 0
        return () => `new-${++id}`
      })(),
    })

    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({
      type: 'score',
      playerId: 'home-1',
      value: 3,
      groupId: 'new-1',
      shotLocation: { area: 'opponent', x: 25, y: 70 },
    })
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
      shotLocation: { area: 'own' },
      createdAt: 60,
      createId: () => 'unused',
    })
    expect(updated).toMatchObject([
      { id: 'score', playerId: 'home-3', value: 3, groupId: 'play', shotLocation: { area: 'own' } },
      { id: 'assist', playerId: 'home-4', groupId: 'play' },
    ])

    const withoutAssist = updateScoringPlay(updated, {
      actionId: 'score',
      teamId: 'home',
      scorerId: 'home-3',
      value: 3,
      assistPlayerId: null,
      shotLocation: { area: 'opponent', x: 51, y: 42 },
      createdAt: 70,
      createId: () => 'unused',
    })
    expect(withoutAssist).toEqual([
      expect.objectContaining({
        id: 'score',
        playerId: 'home-3',
        value: 3,
        shotLocation: { area: 'opponent', x: 51, y: 42 },
      }),
    ])
    expect(withoutAssist[0]).not.toHaveProperty('groupId')
  })

  it('records a score without a shot location and clears a previous location when omitted', () => {
    const actions = updateScoringPlay([], {
      teamId: 'home',
      scorerId: 'home-1',
      value: 2,
      assistPlayerId: null,
      createdAt: 50,
      createId: () => 'new-score',
    })
    expect(actions[0]).not.toHaveProperty('shotLocation')

    const updated = updateScoringPlay([
      makeAction({
        id: 'existing-score',
        type: 'score',
        teamId: 'home',
        playerId: 'home-1',
        shotLocation: { area: 'own' },
      }),
    ], {
      actionId: 'existing-score',
      teamId: 'home',
      scorerId: 'home-2',
      value: 2,
      assistPlayerId: null,
      createdAt: 60,
      createId: () => 'unused',
    })
    expect(updated[0]).not.toHaveProperty('shotLocation')
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

  it('requires between two and five active players per team to start', () => {
    const game = createInitialGameState()
    expect(canStartGame(game)).toBe(true)
    game.players.slice(0, 3).forEach((player) => { player.isOnCourt = false })
    expect(canStartGame(game)).toBe(true)
    game.players[3].isOnCourt = false
    expect(canStartGame(game)).toBe(false)
  })

  it('starts each period with two to five distinct players of the own team', () => {
    const game = createInitialGameState()
    game.period = 0
    game.players.push({ id: 'home-6', teamId: 'home', name: 'Six', jerseyNumber: '6', isOnCourt: false })
    const before = structuredClone(game)
    expect(startNextPeriod(game, ['home-1'])).toBe(false)
    expect(startNextPeriod(game, ['home-1', 'home-2', 'home-3', 'home-4', 'away-1'])).toBe(false)
    expect(startNextPeriod(game, ['home-1', 'home-1', 'home-2', 'home-3', 'home-4'])).toBe(false)
    expect(game).toEqual(before)
    expect(startNextPeriod(game, ['home-1', 'home-2', 'home-3', 'home-4', 'home-6'])).toBe(true)
    expect(game.period).toBe(1)
    expect(game.gameStarted).toBe(true)
    expect(game.players.find((player) => player.id === 'home-5')?.isOnCourt).toBe(false)
    expect(game.players.filter((player) => player.teamId === 'away' && player.isOnCourt)).toHaveLength(5)
    expect(startNextPeriod(game, ['home-1', 'home-2', 'home-3', 'home-4', 'home-5'])).toBe(true)
    expect(game.period).toBe(2)
    expect(startNextPeriod(game, ['home-1', 'home-2'])).toBe(true)
    expect(game.players.filter((player) => player.teamId === 'home' && player.isOnCourt)).toHaveLength(2)
    expect(parseGameState(game).period).toBe(3)
    expect(() => parseGameState({ ...game, period: -1 })).toThrow('periode')
    expect(() => parseGameState({ ...game, period: 1.5 })).toThrow('periode')
  })

  it('counts fouls per player and by non-overlapping youth period pairs, including overtime', () => {
    const game = createInitialGameState()
    game.youth = true
    game.actions = [1, 1, 2, 2, 3, 7, 8, 9].map((period, index) => makeAction({
      id: String(index), playerId: 'home-1', teamId: 'home', type: 'foul', period,
    }))
    expect(getPlayerFouls(game.actions)['home-1']).toBe(8)
    game.period = 2
    expect(getPeriodTeamFouls(game)['home']).toBe(4)
    game.period = 3
    expect(getPeriodTeamFouls(game)['home']).toBe(1)
    game.period = 9
    expect(getPeriodTeamFouls(game)['home']).toBe(3)
    game.youth = false
    game.period = 3
    expect(getPeriodTeamFouls(game)['home']).toBe(1)
    game.period = 5
    expect(getPeriodTeamFouls(game)['home']).toBe(3)
  })

  it('round-trips period, clock and fouls and rejects invalid stored values', () => {
    const game = createInitialGameState()
    game.period = 4
    game.youth = true
    game.clock = { phase: 'halftime', remainingMs: 120_000, deadline: 1_700_000_000_000 }
    game.actions.push(makeAction({ type: 'foul', teamId: 'home', playerId: 'home-1', period: 3 }))
    expect(parseGameState(game)).toEqual(game)
    expect(() => parseGameState({ ...game, clock: { ...game.clock, remainingMs: -1 } })).toThrow('wedstrijdklok')
    expect(() => parseGameState({ ...game, actions: [{ ...game.actions[0], period: 0 }] })).toThrow('wedstrijdacties')
  })

  it('treats a legacy game as being in the first period when advancing', () => {
    const game = createInitialGameState()
    expect(startNextPeriod(game, game.players.slice(0, 5).map((player) => player.id))).toBe(true)
    expect(game.period).toBe(2)
  })

  it('preserves a period in an otherwise unused legacy roster', () => {
    const game = createInitialGameState()
    game.players = game.players.map((player, index) => ({
      ...player,
      id: `${index < 5 ? 'h' : 'a'}${index % 5 + 1}`,
      name: `Speler ${index % 5 + 1}`,
    }))
    game.period = 2
    expect(parseGameState(game).period).toBe(2)
    expect(parseGameState(game).players[0].id).toBe('h1')
  })

  it('does not count selected coaches as roster players when starting a game', () => {
    const game = createInitialGameState()
    game.players.push({
      id: 'home-coach-1',
      name: 'Willem',
      teamId: 'home',
      jerseyNumber: '',
      isOnCourt: false,
      isCoach: true,
      coachRole: 'assistant',
    })

    expect(canStartGame(game)).toBe(true)
    expect(parseGameState(game).players[parseGameState(game).players.length - 1]).toMatchObject({
      id: 'home-coach-1',
      name: 'Willem',
      isCoach: true,
      coachRole: 'assistant',
    })
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

  it('preserves selected schedule match details in saved game state', () => {
    const game = createInitialGameState()
    game.matchInfo = {
      id: 'match-42',
      date: '2026-11-11',
      startTime: '18:15',
      venue: 'Sporthal',
    }

    expect(parseGameState(game).matchInfo).toEqual(game.matchInfo)
    expect(() => parseGameState({ ...game, matchInfo: { ...game.matchInfo, date: 'tomorrow' } })).toThrow('wedstrijdinformatie')
  })

  it('preserves shot locations and rejects invalid court coordinates when loading', () => {
    const game = createInitialGameState()
    game.actions.push(makeAction({
      type: 'score',
      teamId: 'home',
      playerId: 'home-1',
      value: 2,
      shotLocation: { area: 'opponent', x: 36, y: 72 },
    }))

    expect(parseGameState(game).actions[0].shotLocation).toEqual({ area: 'opponent', x: 36, y: 72 })
    expect(() => parseGameState({
      ...game,
      actions: [{ ...game.actions[0], shotLocation: { area: 'opponent', x: 101, y: 50 } }],
    })).toThrow('Opgeslagen wedstrijdacties zijn ongeldig.')
  })

  it('preserves foul types and remains compatible with older foul actions', () => {
    const game = createInitialGameState()
    game.actions.push(makeAction({
      type: 'foul',
      teamId: 'home',
      playerId: 'coach-home',
      foulType: 'TF',
    }))

    expect(parseGameState(game).actions[0]).toMatchObject({
      type: 'foul',
      playerId: 'coach-home',
      foulType: 'TF',
    })
    const legacy = { ...game, actions: [{ ...game.actions[0], foulType: undefined }] }
    expect(parseGameState(legacy).actions[0]).not.toHaveProperty('foulType')
    expect(() => parseGameState({
      ...game,
      actions: [{ ...game.actions[0], foulType: 'invalid' }],
    })).toThrow('Opgeslagen wedstrijdacties zijn ongeldig.')
  })

  it('preserves turnover types, accepts legacy turnovers and rejects invalid types', () => {
    const game = createInitialGameState()
    game.actions.push(makeAction({ type: 'turnover', teamId: 'home', playerId: 'home-1', turnoverType: 'second_dribble' }))
    expect(parseGameState(game).actions[0].turnoverType).toBe('second_dribble')
    for (const turnoverType of ['turnover', 'travel'] as const) {
      expect(parseGameState({ ...game, actions: [{ ...game.actions[0], turnoverType }] }).actions[0].turnoverType).toBe(turnoverType)
    }
    expect(parseGameState({ ...game, actions: [{ ...game.actions[0], turnoverType: undefined }] }).actions[0]).not.toHaveProperty('turnoverType')
    expect(() => parseGameState({ ...game, actions: [{ ...game.actions[0], turnoverType: 'invalid' }] })).toThrow()
    expect(() => parseGameState({ ...game, actions: [{ ...game.actions[0], type: 'foul' }] })).toThrow()
  })

  it('loads and saves the existing local-storage key without dropping game data', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const game = createInitialGameState()
    game.gameStarted = true
    game.actions.push(makeAction({
      type: 'score',
      teamId: 'home',
      playerId: 'home-1',
      value: 2,
      shotLocation: { area: 'own' },
    }))

    saveGameState(game, storage)

    expect(gameStorageKey).toBe('watchtower-game-v1')
    expect(loadGameState('nl', storage)).toEqual(game)
  })
})
