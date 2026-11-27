// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref, type App } from 'vue'
import { createInitialGameState, foulCoachId } from '../domain/game'
import { saveGameState } from '../services/gameStorage'
import { loadMatchEvents, saveMatchLink } from '../services/matchEventLog'
import { loadPendingMatchSnapshots } from '../services/matchSnapshots'
import { loadLocalMatches } from '../services/localMatches'
import { joinMatchSession } from '../services/sharedMatch'
import { loadLiveMatch } from '../services/liveMatch'
import { loadMatchScorers, restoreMyMatchSnapshot } from '../services/statistics'
import { uploadLiveState } from '../services/matchLiveState'
import { useGameSession } from './useGameSession'

vi.mock('../services/supabaseClient', () => ({
  ensureAnonymousUser: vi.fn(async () => 'tracker'),
  isSupabaseConfigured: () => true,
}))
vi.mock('../services/sharedMatch', () => ({
  joinMatchSession: vi.fn(),
  uploadMatchEvents: vi.fn(async () => {}),
  uploadMatchSnapshot: vi.fn(async () => {}),
}))
vi.mock('../services/zoebasTeams', () => ({
  loadZoebasTeams: vi.fn(async () => []), loadCachedZoebasTeams: vi.fn(() => null), saveCachedZoebasTeams: vi.fn(),
}))
vi.mock('../services/statistics', () => ({ loadMatchScorers: vi.fn(), restoreMyMatchSnapshot: vi.fn() }))
vi.mock('../services/matchLiveState', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/matchLiveState')>(), uploadLiveState: vi.fn(async () => {}),
}))
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
    saveMatchLink({ matchId: 'match', trackerId: 'tracker', displayName: 'Scorer' })
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
    session.selectAssist('none')
    session.commitPendingAction()
    session.addOpponentScore(2)
    expect(session.game.actions.filter((action) => action.type === 'score').map((action) => action.period)).toEqual([1, 1, 1])
  })
})

describe('event flows', () => {
  it('shares the roster, lineup and period with viewers and again after a substitution', async () => {
    const game = createInitialGameState()
    game.gameStarted = true
    game.period = 1
    saveGameState(game)
    saveMatchLink({ matchId: 'match', trackerId: 'tracker', displayName: 'Scorer' })
    let session!: ReturnType<typeof useGameSession>
    app = createApp({ setup() { session = useGameSession(); return () => h('div') } })
    app.mount(document.body.appendChild(document.createElement('div')))

    await vi.waitFor(() => expect(uploadLiveState).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(vi.mocked(uploadLiveState).mock.calls[0][0]).toBe('match')
    expect(vi.mocked(uploadLiveState).mock.calls[0][1]).toMatchObject({ teamId: 'home', period: 1, gameStarted: true })

    session.game.players[0].isOnCourt = false
    await vi.waitFor(() => expect(uploadLiveState).toHaveBeenCalledTimes(2), { timeout: 3000 })
    const shared = vi.mocked(uploadLiveState).mock.calls[1][1]
    expect(shared.players.find((player) => player.id === 'home-1')?.isOnCourt).toBe(false)
  })

  async function mountStartedGame(expertMode = ref(true)) {
    const game = createInitialGameState()
    game.gameStarted = true
    game.period = 1
    saveGameState(game)
    let session!: ReturnType<typeof useGameSession>
    app = createApp({ setup() { session = useGameSession(expertMode); return () => h('div') } })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(session.game.gameStarted).toBe(true))
    return session
  }

  it('records detailed events after one player selection when expert mode is off', async () => {
    const session = await mountStartedGame(ref(false))

    session.addAction('score', 3)
    session.selectPlayer('home-1')
    session.addAction('foul', 1)
    session.selectPlayer(foulCoachId('home'))
    session.addAction('turnover', 1)
    session.selectPlayer('home-2')

    expect(session.pendingAction.value).toBeNull()
    expect(session.game.actions).toMatchObject([
      { type: 'score', value: 3, playerId: 'home-1' },
      { type: 'foul', playerId: foulCoachId('home'), foulType: undefined },
      { type: 'turnover', playerId: 'home-2', turnoverType: 'turnover' },
    ])
  })

  it('asks for the rebound after a missed home shot and records a defensive rebound for the opponent', async () => {
    const session = await mountStartedGame()
    session.addAction('missed_shot', 2)
    session.selectPlayer('home-2')
    expect(session.pendingFlow.value).toEqual(['player', 'rebound', 'location'])
    expect(session.pendingFlowIndex.value).toBe(1)
    session.selectRebound('opponent')
    session.commitPendingAction()

    const [miss, rebound] = session.game.actions
    expect(miss).toMatchObject({ type: 'missed_shot', playerId: 'home-2', value: 2 })
    expect(rebound).toMatchObject({ type: 'defensive_rebound', playerId: null, teamId: 'away' })
    expect(rebound.groupId).toBeDefined()
    expect(rebound.groupId).toBe(miss.groupId)
    session.undoLastAction()
    expect(session.game.actions).toEqual([])
  })

  it('keeps a missed free throw without a location and without a rebound when none is chosen', async () => {
    const session = await mountStartedGame()
    session.addAction('missed_shot', 1)
    session.selectPlayer('home-1')
    expect(session.pendingFlow.value).toEqual(['player', 'rebound'])
    session.selectRebound('none')
    expect(session.game.actions).toMatchObject([{ type: 'missed_shot', playerId: 'home-1', value: 1 }])
    expect(session.game.actions[0].groupId).toBeUndefined()
  })
  it('assigns a foul to the fixed coach of the team', async () => {
    const session = await mountStartedGame()
    session.addAction('foul', 1)
    session.selectPlayer(foulCoachId('home'))
    session.chooseFoulType('P')
    expect(session.game.actions).toMatchObject([{ type: 'foul', playerId: 'coach-home', foulType: 'P' }])
  })
  it('limits a field player to five personal fouls', async () => {
    const session = await mountStartedGame()
    for (let index = 0; index < 5; index++) {
      session.addAction('foul', 1)
      session.selectPlayer('home-1')
      session.chooseFoulType('P')
    }
    session.addAction('foul', 1)
    session.selectPlayer('home-1')
    session.chooseFoulType('P')
    expect(session.game.actions.filter((action) => action.foulType === 'P')).toHaveLength(5)
    session.chooseFoulType('U')
    expect(session.game.actions.at(-1)).toMatchObject({ type: 'foul', foulType: 'U', playerId: 'home-1' })
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
      expect(await session.joinSharedMatch('match', 'Scorer')).toBe(false)
      expect(joinMatchSession).not.toHaveBeenCalled()
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
    const link = { matchId: 'match', trackerId: 'tracker', displayName: 'Scorer' }
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

    expect(await session.joinSharedMatch('match', 'Scorer', 'away')).toBe(true)
    expect(session.game.teams.map((team) => team.id)).toEqual(['away', 'home'])
    expect(session.game.teams.map((team) => team.color)).toEqual(['#f26a36', '#5d72d9'])
    expect(session.game.catalogTeamId).toBeUndefined()
    expect(session.selectedTeamId.value).toBe('away')
    expect(session.game.actions).toEqual([{ id: 'h1', playerId: null, teamId: 'home', type: 'score', value: 2, createdAt: 1 }])
    expect(loadPendingMatchSnapshots()[0].catalogTeamId).toBeNull()
  })
})

describe('practice games', () => {
  const home = {
    id: 'zoebas-x12-1', name: 'X12-1', catalogTeamId: 'x12-1', coaches: [],
    players: [1, 2].map((number) => ({ id: `p${number}`, name: `Home ${number}`, jerseyNumber: String(number), isParticipating: true, isOnCourt: false })),
  }
  const opponent = (count: number) => ({
    id: 'opponent', name: 'Friends', coaches: [],
    players: Array.from({ length: count }, (_, index) => ({ id: `o${index}`, name: `Away ${index}`, jerseyNumber: String(index + 10), isParticipating: true, isOnCourt: false })),
  })

  async function mountSession() {
    let session!: ReturnType<typeof useGameSession>
    app = createApp({ setup() { session = useGameSession(); return () => h('div') } })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(session.teamSetupInitializing.value).toBe(false))
    return session
  }

  it('records the manually entered opponent without a schedule start or end', async () => {
    const session = await mountSession()
    expect(session.applyTeamSetup([home, opponent(7)], [home.id, 'opponent'], null, 'M16-1', '', true, 'Friends')).toBe(true)
    expect(session.game.matchInfo).toMatchObject({ kind: 'practice', venue: '' })
    expect(session.game.matchInfo?.id).toMatch(/^practice-/)
    expect(session.game.catalogTeamId).toBe('x12-1')
    expect(session.game.teams[1]).toMatchObject({ name: 'M16-1', club: 'Friends' })
    const away = session.game.players.filter((player) => player.teamId === 'away')
    expect(away.map((player) => player.name)).toEqual(Array.from({ length: 7 }, (_, index) => `Away ${index}`))
    expect(away.filter((player) => player.isOnCourt)).toHaveLength(5)
  })

  it('requires opponent players and a club team', async () => {
    const session = await mountSession()
    expect(session.applyTeamSetup([home, opponent(1)], [home.id, 'opponent'], null, 'Friends', '', true)).toBe(false)
    const local = { ...home, id: 'local', catalogTeamId: 'local-1' }
    expect(session.applyTeamSetup([local, opponent(2)], [local.id, 'opponent'], null, 'Friends', '', true)).toBe(false)
    expect(session.game.matchInfo).toBeUndefined()
  })
})
