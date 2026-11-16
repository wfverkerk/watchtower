// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'
import UpcomingGamesPage from './UpcomingGamesPage.vue'
import { useFavoriteTeams } from '../composables/useFavoriteTeams'
import { joinMatchSession, openScheduleSession, transferMatchScorer } from '../services/sharedMatch'
import { loadMatchScorers } from '../services/statistics'
import { loadSchedule } from '../services/zoebasSchedule'

vi.mock('../services/sharedMatch', () => ({
  listMatchSessions: vi.fn(async () => [{
    id: 'match', startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    teams: [{ id: 'home', name: 'Team A', color: '#000' }, { id: 'away', name: 'Team B', color: '#fff' }],
    scheduleId: 'game-a', status: 'open', closed: false, canClose: false, canReview: false,
  }]),
  closeMatchSession: vi.fn(),
  openScheduleSession: vi.fn(),
  joinMatchSession: vi.fn(async () => ({ link: { matchId: 'match', trackerId: 'me' } })),
  transferMatchScorer: vi.fn(async () => {}),
  setSessionFinal: vi.fn(),
}))
vi.mock('../services/statistics', () => ({ loadMatchScorers: vi.fn() }))
const scorerInfo = (scorerId: string | null) => ({ finishedAt: null, officialTrackerId: null, scorerId, scorers: [] })
vi.mock('../services/zoebasSchedule', () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    loadSchedule: vi.fn(async () => [{
      id: 'game-a', kind: 'program', date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      startTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`, homeTeam: 'Team A', awayTeam: 'Team B',
      homeScore: null, awayScore: null, status: '', venue: '',
    }]),
  }
})

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

describe('upcoming sessions', () => {
  it('lists the running practice game of this device as live today and resumes it on tap', async () => {
    const resume = vi.fn()
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: false, hasCurrentGame: true, currentMatchId: null, displayName: 'Scorer', onResume: resume,
      practiceGame: { homeTeam: 'X12-1', awayTeam: 'Vrienden', homeScore: 6, awayScore: 4, startTime: '19:30' },
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    const card = document.querySelector('.practice-open-game')!
    expect(card.textContent).toContain('Vrienden')
    expect(card.querySelector('.schedule-score.is-live')?.textContent).toContain('6 – 4')
    expect(card.querySelector('.live-score-label')?.textContent).toBe('Live')
    expect(document.body.textContent).not.toContain('Geen open wedstrijden vandaag.')
    card.querySelector<HTMLButtonElement>('.schedule-open-trigger')!.click()
    expect(resume).toHaveBeenCalled()
  })

  it('blocks opening another game while a game is active and resumes the active game on tap', async () => {
    const resume = vi.fn()
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: true, currentMatchId: 'match', displayName: 'Scorer', onJoin: vi.fn(), onResume: resume,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelector('.schedule-game')).not.toBeNull())
    const trigger = document.querySelector<HTMLButtonElement>('.schedule-open-trigger')!
    expect(trigger.disabled).toBe(false)
    trigger.click()
    expect(resume).toHaveBeenCalled()
    expect(document.querySelector('.join-side-picker')).toBeNull()
  })

  it('lets you become the scorer of a game without one, after a disclaimer and a choice of team', async () => {
    vi.mocked(loadMatchScorers).mockResolvedValueOnce(scorerInfo(null))
    const join = vi.fn()
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: false, currentMatchId: null, displayName: 'Scorer', onJoin: join,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelector('.schedule-game')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.schedule-open-trigger')!.click()
    await vi.waitFor(() => expect(document.querySelector('.role-options')).not.toBeNull())
    expect(joinMatchSession).toHaveBeenCalledWith('match', 'Scorer')
    expect(document.querySelectorAll<HTMLButtonElement>('.role-option')[1].disabled).toBe(false)

    document.querySelectorAll<HTMLButtonElement>('.role-option')[0].click()
    await vi.waitFor(() => expect(document.querySelector('.role-disclaimer')).not.toBeNull())
    expect(document.querySelector('.role-disclaimer')!.textContent).toContain('verantwoordelijk')
    document.querySelectorAll<HTMLButtonElement>('.join-side-option')[1].click()
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.join-side-picker .match-sync-primary')!.disabled).toBe(false))
    document.querySelector<HTMLButtonElement>('.join-side-picker .match-sync-primary')!.click()
    await vi.waitFor(() => expect(join).toHaveBeenCalledWith('match', 'away'))
    expect(transferMatchScorer).toHaveBeenCalledWith('match')
  })

  it('lets you choose to watch along instead, and watches directly when the game already has a scorer', async () => {
    vi.mocked(loadMatchScorers).mockResolvedValueOnce(scorerInfo(null)).mockResolvedValueOnce(scorerInfo('someone-else'))
    const view = vi.fn()
    const join = vi.fn()
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: false, currentMatchId: null, displayName: 'Viewer', onJoin: join, onView: view,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelector('.schedule-game')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.schedule-open-trigger')!.click()
    await vi.waitFor(() => expect(document.querySelector('.role-options')).not.toBeNull())
    document.querySelectorAll<HTMLButtonElement>('.role-option')[1].click()
    expect(view).toHaveBeenCalledWith('match')
    await vi.waitFor(() => expect(document.querySelector('.role-options')).toBeNull())

    document.querySelector<HTMLButtonElement>('.schedule-open-trigger')!.click()
    await vi.waitFor(() => expect(view).toHaveBeenCalledTimes(2))
    expect(document.querySelector('.role-options')).toBeNull()
    expect(transferMatchScorer).not.toHaveBeenCalled()
    expect(join).not.toHaveBeenCalled()
  })

  it('resumes as the scorer when this device already is the scorer of the game', async () => {
    vi.mocked(loadMatchScorers).mockResolvedValueOnce(scorerInfo('me'))
    const join = vi.fn()
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: false, currentMatchId: null, displayName: 'Scorer', onJoin: join,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelector('.schedule-game')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.schedule-open-trigger')!.click()
    await vi.waitFor(() => expect(join).toHaveBeenCalledWith('match', 'home'))
    expect(document.querySelector('.role-options')).toBeNull()
  })

  it('shows why taking the scorer role failed', async () => {
    vi.mocked(loadMatchScorers).mockResolvedValueOnce(scorerInfo(null))
    vi.mocked(transferMatchScorer).mockRejectedValueOnce(new Error('Taking over is not possible for this match'))
    const join = vi.fn()
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: false, currentMatchId: null, displayName: 'Scorer', onJoin: join,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelector('.schedule-game')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.schedule-open-trigger')!.click()
    await vi.waitFor(() => expect(document.querySelector('.role-options')).not.toBeNull())
    document.querySelectorAll<HTMLButtonElement>('.role-option')[0].click()
    await vi.waitFor(() => expect(document.querySelector('.join-side-picker')).not.toBeNull())
    document.querySelectorAll<HTMLButtonElement>('.join-side-option')[0].click()
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.join-side-picker .match-sync-primary')!.disabled).toBe(false))
    document.querySelector<HTMLButtonElement>('.join-side-picker .match-sync-primary')!.click()
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('niet worden'))
    expect(join).not.toHaveBeenCalled()
  })

  it('lets you watch a game nobody has started yet: the session opens without a scorer', async () => {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    vi.mocked(loadSchedule).mockResolvedValueOnce([{
      id: 'game-b', kind: 'program', date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      startTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`, homeTeam: 'Team C', awayTeam: 'Team D',
      homeScore: null, awayScore: null, status: '', venue: '',
    }])
    vi.mocked(openScheduleSession).mockResolvedValueOnce({ link: { matchId: 'new-match' } } as never)
    const view = vi.fn()
    const join = vi.fn()
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: false, currentMatchId: null, displayName: 'Viewer', onJoin: join, onView: view,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelector('.schedule-open-trigger')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.schedule-open-trigger')!.click()
    await vi.waitFor(() => expect(document.querySelector('.role-options')).not.toBeNull())
    document.querySelectorAll<HTMLButtonElement>('.role-option')[1].click()
    await vi.waitFor(() => expect(view).toHaveBeenCalledWith('new-match'))
    expect(openScheduleSession).toHaveBeenCalledWith('game-b', expect.any(Object), 'Viewer')
    expect(transferMatchScorer).not.toHaveBeenCalled()
    expect(join).not.toHaveBeenCalled()
  })

  it('opens the session and becomes its scorer when nobody has started a scheduled game yet', async () => {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    vi.mocked(loadSchedule).mockResolvedValueOnce([{
      id: 'game-b', kind: 'program', date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      startTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`, homeTeam: 'Team C', awayTeam: 'Team D',
      homeScore: null, awayScore: null, status: '', venue: '',
    }])
    vi.mocked(openScheduleSession).mockResolvedValueOnce({ link: { matchId: 'new-match' } } as never)
    const join = vi.fn()
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: false, currentMatchId: null, displayName: 'First', onJoin: join,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelector('.schedule-open-trigger')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.schedule-open-trigger')!.click()
    await vi.waitFor(() => expect(document.querySelector('.role-options')).not.toBeNull())
    expect(document.querySelectorAll<HTMLButtonElement>('.role-option')[1].disabled).toBe(false)
    expect(document.querySelector('.role-notice')?.textContent).toContain('Er is nog geen scorer')
    expect(joinMatchSession).not.toHaveBeenCalled()
    document.querySelectorAll<HTMLButtonElement>('.role-option')[0].click()
    await vi.waitFor(() => expect(document.querySelector('.join-side-picker')).not.toBeNull())
    document.querySelectorAll<HTMLButtonElement>('.join-side-option')[0].click()
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.join-side-picker .match-sync-primary')!.disabled).toBe(false))
    document.querySelector<HTMLButtonElement>('.join-side-picker .match-sync-primary')!.click()
    await vi.waitFor(() => expect(join).toHaveBeenCalledWith('new-match', 'home'))
    expect(transferMatchScorer).toHaveBeenCalledWith('new-match')
    expect(openScheduleSession).toHaveBeenCalledWith('game-b', expect.objectContaining({
      teams: [expect.objectContaining({ name: 'Team C' }), expect.objectContaining({ name: 'Team D' })],
    }), 'First')
  })

  it('groups history per day in collapsed sections and labels games with statistics', async () => {
    const result = (id: string, date: string, hasStats: boolean) => ({
      id, kind: 'result' as const, date, startTime: '18:00', homeTeam: 'Team A', awayTeam: 'Team B',
      homeScore: 60, awayScore: 55, status: 'Finished', venue: '', hasStats,
    })
    vi.mocked(loadSchedule).mockResolvedValueOnce([
      result('r1', '2026-11-10', true), result('r2', '2026-11-10', false), result('r3', '2026-11-09', false),
    ])
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: false, currentMatchId: null, displayName: 'Scorer', onJoin: vi.fn(),
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelectorAll('details.history-day')).toHaveLength(2))
    const days = [...document.querySelectorAll<HTMLDetailsElement>('details.history-day')]
    expect(days.every((day) => !day.open)).toBe(true)
    expect(days[0].querySelectorAll('article')).toHaveLength(2)
    expect(document.querySelectorAll('.stats-label.has-stats')).toHaveLength(1)
    expect(document.querySelectorAll('.stats-label.no-stats')).toHaveLength(2)
  })

  it('filters on my teams when favorites exist and reopens the team editor from the bottom button', async () => {
    useFavoriteTeams().setFavorites(['Team A'])
    const result = (id: string, homeTeam: string, awayTeam: string) => ({
      id, kind: 'result' as const, date: '2026-11-08', startTime: '18:00', homeTeam, awayTeam,
      homeScore: 60, awayScore: 55, status: 'Finished', venue: '', hasStats: false,
    })
    vi.mocked(loadSchedule).mockResolvedValueOnce([result('m1', 'Team A', 'Team B'), result('m2', 'Team C', 'Team D')])
    app = createApp({ render: () => h(UpcomingGamesPage, {
      configured: true, hasCurrentGame: false, currentMatchId: null, displayName: 'Scorer', onJoin: vi.fn(),
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.querySelectorAll('details.history-day article')).toHaveLength(1))
    expect(document.querySelector('.landing-toggle .is-active')?.textContent).toBe('Mijn teams')
    const changeButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Mijn teams wijzigen')!
    changeButton.click()
    await vi.waitFor(() => expect(document.querySelector('.my-teams-editor')).not.toBeNull())
    expect(document.querySelector('.history-day')).toBeNull()
    useFavoriteTeams().setFavorites([])
  })
})
