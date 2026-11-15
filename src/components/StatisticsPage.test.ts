// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createInitialGameState } from '../domain/game'
import StatisticsPage from './StatisticsPage.vue'

const api = vi.hoisted(() => ({
  loadStatisticsTeams: vi.fn(),
  loadStatisticsRoster: vi.fn(),
  loadStatisticsHistory: vi.fn(),
  loadMatchScorers: vi.fn(),
  finishStatisticsMatch: vi.fn(),
  joinStatisticsTeam: vi.fn(),
  linkStatisticsPlayer: vi.fn(),
  saveStatisticsPlayer: vi.fn(),
  selectOfficialScorer: vi.fn(),
}))
vi.mock('../services/statistics', () => api)

let app: App | undefined
beforeEach(() => {
  vi.resetAllMocks()
  api.loadStatisticsTeams.mockResolvedValue([{ id: 'team', name: 'Team', isCoach: false }])
  api.loadStatisticsRoster.mockResolvedValue([{ id: 'one', name: null, jerseyNumber: '12', isPrivate: true }])
  const game = createInitialGameState()
  game.players = [{ id: 'home-one', teamId: 'home', name: '', jerseyNumber: '12', isOnCourt: false }]
  game.actions = [{ id: 'action', playerId: 'home-one', teamId: 'home', type: 'score', value: 3, createdAt: 1 }]
  api.loadStatisticsHistory.mockResolvedValue([{
    id: 'match', finishedAt: '2026-01-01T10:00:00Z', trackerId: 'scorer',
    snapshotUpdatedAt: '2026-01-01T10:00:00Z', matchDate: '2026-01-01',
    game, links: {}, canEdit: true,
  }])
  api.loadMatchScorers.mockResolvedValue({
    finishedAt: null, officialTrackerId: null,
    scorers: [{ id: 'scorer', name: 'Scorer', updatedAt: '2026-01-01T10:00:00Z' }],
  })
})
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('statistics page', () => {
  it('shows a private player by jersey and calculates game totals and trends', async () => {
    app = createApp({ render: () => h(StatisticsPage, { matchLink: null, syncStatus: 'local' }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Totaal · 1 wedstrijden'))
    expect(document.querySelector('.statistics-metrics strong')?.textContent).toBe('3')
    expect(document.querySelector('.statistics-trend-values')?.textContent).toContain('3')
    expect(document.body.textContent).toContain('#12')
    expect(document.body.textContent).not.toContain('Gedeelde spelerslijst beheren')
  })

  it('orders trend values by match date even if the server response is unordered', async () => {
    const game = createInitialGameState()
    game.players = [{ id: 'home-one', teamId: 'home', name: '', jerseyNumber: '12', isOnCourt: false }]
    game.actions = [{ id: 'action', playerId: 'home-one', teamId: 'home', type: 'score', value: 2, createdAt: 1 }]
    const base = { finishedAt: '2026-01-03T10:00:00Z', trackerId: 'scorer', snapshotUpdatedAt: '2026-01-03T10:00:00Z', game, links: {}, canEdit: true }
    api.loadStatisticsHistory.mockResolvedValue([
      { ...base, id: 'old', matchDate: '2026-01-01' },
      { ...base, id: 'new', matchDate: '2026-01-02' },
    ])
    app = createApp({ render: () => h(StatisticsPage, { matchLink: null, syncStatus: 'local' }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelectorAll('.statistics-trend-values li')).toHaveLength(2))
    expect(document.querySelector('.statistics-trend-values li')?.textContent).toContain('2026-01-01')
  })

  it('requires synchronization before finishing and submits the selected scorer', async () => {
    const finished = vi.fn()
    const status = ref('offline')
    vi.stubGlobal('confirm', vi.fn(() => true))
    app = createApp({ render: () => h(StatisticsPage, {
      matchLink: { matchId: 'match', joinCode: 'CODE', trackerId: 'scorer', displayName: 'Scorer' },
      syncStatus: status.value, onFinished: finished,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Wedstrijd afsluiten'))
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Wedstrijd afsluiten'))!
    expect(button.disabled).toBe(true)
    status.value = 'synced'
    await nextTick()
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    button.click()
    await vi.waitFor(() => expect(api.finishStatisticsMatch).toHaveBeenCalledWith('match', 'team', 'scorer'))
  })

  it('leaves practice games out of the totals until they are included', async () => {
    const game = createInitialGameState()
    game.players = [{ id: 'home-one', teamId: 'home', name: '', jerseyNumber: '12', isOnCourt: false }]
    game.actions = [{ id: 'action', playerId: 'home-one', teamId: 'home', type: 'score', value: 2, createdAt: 1 }]
    const base = { finishedAt: '2026-01-03T10:00:00Z', trackerId: 'scorer', snapshotUpdatedAt: '2026-01-03T10:00:00Z', game, links: {}, canEdit: true }
    api.loadStatisticsHistory.mockResolvedValue([
      { ...base, id: 'official', matchDate: '2026-01-01', practice: false },
      { ...base, id: 'practice', matchDate: '2026-01-02', practice: true, game: { ...game, teams: [game.teams[0], { ...game.teams[1], name: 'M16-1', club: 'Vrienden' }] } },
    ])
    app = createApp({ render: () => h(StatisticsPage, { matchLink: null, syncStatus: 'local' }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Totaal · 1 wedstrijden'))
    expect(document.querySelector('.statistics-metrics strong')?.textContent).toBe('2')
    expect(document.body.textContent).not.toContain('Oefenwedstrijd ·')
    const filter = document.querySelector<HTMLInputElement>('.statistics-practice-filter input')!
    expect(filter.checked).toBe(false)
    filter.click()
    await nextTick()
    expect(document.body.textContent).toContain('Totaal · 2 wedstrijden')
    expect(document.querySelector('.statistics-metrics strong')?.textContent).toBe('4')
    expect(document.body.textContent).toContain('2026-01-02 · Thuis – Vrienden M16-1 · Oefenwedstrijd')
  })
})
