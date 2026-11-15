// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'
import { createInitialGameState } from '../domain/game'
import { saveGameState } from '../services/gameStorage'
import { loadMatchEvents, saveMatchLink } from '../services/matchEventLog'
import { loadPendingMatchSnapshots } from '../services/matchSnapshots'
import { loadLocalMatches } from '../services/localMatches'
import { joinMatchSession, joinSharedMatch } from '../services/sharedMatch'
import { loadLiveMatch } from '../services/liveMatch'
import { loadMatchScorers, restoreMyMatchSnapshot } from '../services/statistics'
import { useGameSession } from './useGameSession'

vi.mock('../services/supabaseClient', () => ({
  ensureAnonymousUser: vi.fn(async () => 'tracker'),
  isSupabaseConfigured: () => true,
}))
vi.mock('../services/sharedMatch', () => ({
  createSharedMatch: vi.fn(), joinSharedMatch: vi.fn(), joinMatchSession: vi.fn(),
  uploadMatchEvents: vi.fn(async () => {}),
  uploadMatchSnapshot: vi.fn(async () => {}),
}))
vi.mock('../services/zoebasTeams', () => ({
  loadZoebasTeams: vi.fn(async () => []), loadCachedZoebasTeams: vi.fn(() => null), saveCachedZoebasTeams: vi.fn(),
}))
vi.mock('../services/statistics', () => ({ loadMatchScorers: vi.fn(), restoreMyMatchSnapshot: vi.fn() }))
vi.mock('../services/liveMatch', async (importOriginal) => ({ ...await importOriginal<typeof import('../services/liveMatch')>(), loadLiveMatch: vi.fn() }))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  window.localStorage.clear()
})

describe('finishing a shared match', () => {
  it('stops the clock and keeps post-match corrections in both synchronization queues', async () => {
    const game = createInitialGameState()
    game.gameStarted = true
    game.period = 1
    game.clock = { phase: 'period', remainingMs: 60_000, deadline: Date.now() + 60_000 }
    saveGameState(game)
    saveMatchLink({ matchId: 'match', trackerId: 'tracker', joinCode: 'CODE', displayName: 'Scorer' })
    let session!: ReturnType<typeof useGameSession>
    app = createApp({ setup() { session = useGameSession(); return () => h('div') } })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(session.matchLink.value?.matchId).toBe('match'))

    session.markMatchFinished()
    expect(session.matchLink.value?.finished).toBe(true)
    expect(session.game.gameStarted).toBe(false)
    expect(session.game.clock?.deadline).toBeNull()
    session.addAction('assist')
    session.selectPlayer('home-1')
    expect(session.game.actions).toHaveLength(1)
    expect(loadMatchEvents().at(-1)?.action.type).toBe('assist')
    expect(loadPendingMatchSnapshots()[0].actions).toHaveLength(1)
    session.addAction('score', 1)
    session.selectPlayer('home-1')
    session.addAction('score', 2)
    session.selectPlayer('home-1')
    session.finishShotAction()
    session.addOpponentScore(2)
    expect(session.game.actions.filter((action) => action.type === 'score').map((action) => action.period)).toEqual([1, 1, 1])
  })
})

describe('local match preservation', () => {
  it('blocks joining by code until the active local game has been archived', async () => {
    const game = createInitialGameState()
    game.gameStarted = true
    game.period = 1
    game.actions = [{ id: 'score', playerId: 'home-1', teamId: 'home', type: 'score', value: 2, createdAt: 1 }]
    saveGameState(game)
    let session!: ReturnType<typeof useGameSession>
    app = createApp({ setup() { session = useGameSession(); return () => h('div') } })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(session.teamSetupInitializing.value).toBe(false))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await session.joinSharedMatch('CODE', 'Scorer')).toBe(false)
      expect(joinSharedMatch).not.toHaveBeenCalled()
      expect(session.game.actions[0].id).toBe('score')
      expect(session.finishLocalMatch()).toBe(true)
      expect(loadLocalMatches()[0].game.actions[0].id).toBe('score')
      expect(session.game.localFinishedAt).toBeTruthy()
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('registering for the away side', () => {
  it('turns the away team into the own team without leaking the other side\'s players or the catalog team', async () => {
    const initial = createInitialGameState()
    initial.catalogTeamId = 'x12-1'
    const link = { matchId: 'match', trackerId: 'tracker', joinCode: 'CODE', displayName: 'Scorer' }
    vi.mocked(joinMatchSession).mockResolvedValue({ link, gameData: initial } as Awaited<ReturnType<typeof joinMatchSession>>)
    vi.mocked(restoreMyMatchSnapshot).mockImplementation(async (_id, game) => ({ revision: 0, game }))
    vi.mocked(loadMatchScorers).mockResolvedValue({ finishedAt: null, officialTrackerId: null, scorers: [] })
    vi.mocked(loadLiveMatch).mockResolvedValue({
      sourceId: 'owner', ownerId: 'owner', links: [],
      events: [
        { id: 'e1', trackerId: 'owner', trackerName: 'Owner', actionId: 'h1', type: 'action_added', sequence: 1,
          action: { id: 'h1', playerId: 'home-1', teamId: 'home', type: 'score', value: 2, createdAt: 1 } },
        { id: 'e2', trackerId: 'owner', trackerName: 'Owner', actionId: 'a1', type: 'action_added', sequence: 2,
          action: { id: 'a1', playerId: null, teamId: 'away', type: 'score', value: 3, createdAt: 2 } },
        { id: 'e3', trackerId: 'owner', trackerName: 'Owner', actionId: 'r1', type: 'action_added', sequence: 3,
          action: { id: 'r1', playerId: 'home-2', teamId: 'home', type: 'rebound', value: 1, createdAt: 3 } },
      ],
    })
    let session!: ReturnType<typeof useGameSession>
    app = createApp({ setup() { session = useGameSession(); return () => h('div') } })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(session.teamSetupInitializing.value).toBe(false))

    expect(await session.joinSharedMatch('match', 'Scorer', true, 'away')).toBe(true)
    expect(session.game.teams.map((team) => team.id)).toEqual(['away', 'home'])
    expect(session.game.teams.map((team) => team.color)).toEqual(['#f26a36', '#5d72d9'])
    expect(session.game.catalogTeamId).toBeUndefined()
    expect(session.selectedTeamId.value).toBe('away')
    expect(session.game.actions).toEqual([{ id: 'h1', playerId: null, teamId: 'home', type: 'score', value: 2, createdAt: 1 }])
    expect(loadPendingMatchSnapshots()[0].catalogTeamId).toBeNull()
  })
})
