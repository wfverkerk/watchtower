// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import MatchViewerPage from './MatchViewerPage.vue'
import { createInitialGameState } from '../domain/game'
import { buildLiveState } from '../services/matchLiveState'
import { watchViewerMatch, type ViewerMatch } from '../services/viewerMatch'

vi.mock('../services/sharedMatch', () => ({
  loadSharedGame: vi.fn(async () => {
    const { createInitialGameState: create } = await import('../domain/game')
    const game = create()
    game.teams = [{ id: 'home', name: 'Zoebas U12', color: '#f26a36' }, { id: 'away', name: 'Tegenstander', color: '#2f6fdb' }]
    return game
  }),
}))
vi.mock('../services/statistics', () => ({ loadMatchScorers: vi.fn(async () => ({ scorerName: 'Coach Piet', scorerId: 'scorer' })) }))
vi.mock('../services/viewerMatch', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/viewerMatch')>(),
  watchViewerMatch: vi.fn(async () => () => {}),
}))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

describe('match viewer page', () => {
  it('shows the score, the players on court and the activity without any event buttons', async () => {
    const close = vi.fn()
    app = createApp({ render: () => h(MatchViewerPage, { matchId: 'match', onClose: close }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(watchViewerMatch).toHaveBeenCalled())
    const publish = vi.mocked(watchViewerMatch).mock.calls[0][1]

    const game = createInitialGameState()
    game.teams = [{ id: 'home', name: 'Zoebas U12', color: '#f26a36' }, { id: 'away', name: 'Tegenstander', color: '#2f6fdb' }]
    game.gameStarted = true
    game.period = 1
    game.players = [
      { id: 'p1', name: 'Sam', teamId: 'home', jerseyNumber: '7', isOnCourt: true },
      { id: 'p2', name: 'Noor', teamId: 'home', jerseyNumber: '9', isOnCourt: false },
    ]
    const match: ViewerMatch = {
      ownerId: 'owner', sourceId: 'scorer', scorerId: 'scorer', finishedAt: null, state: buildLiveState(game),
      events: [{
        id: 'e1', trackerId: 'scorer', trackerName: 'Coach Piet', actionId: 'a1', type: 'action_added', sequence: 1,
        action: { id: 'a1', playerId: 'p1', teamId: 'home', type: 'score', value: 3, createdAt: 1 },
      }],
    }
    publish(match)
    await vi.waitFor(() => expect(document.querySelector('.scoreboard')).not.toBeNull())

    expect(document.querySelector('.home-score strong')?.textContent).toBe('3')
    expect(document.querySelector('.court-lineup')?.textContent).toContain('Sam')
    expect(document.querySelector('.court-lineup')?.textContent).not.toContain('Noor')
    expect(document.querySelector('.activity-panel')?.textContent).toContain('Sam')
    expect(document.querySelector('.team-stats')).toBeNull()
    expect(document.querySelector('.start-button, .new-match-button, .activity-undo, .activity-edit, .game-controls')).toBeNull()
    expect(document.querySelector<HTMLInputElement>('.team-name')!.readOnly).toBe(true)
    await vi.waitFor(() => expect(document.querySelector('.viewer-badge')?.textContent).toContain('Coach Piet'))

    document.querySelector<HTMLButtonElement>('.viewer-bar .text-button')!.click()
    await nextTick()
    expect(close).toHaveBeenCalled()
  })
})
