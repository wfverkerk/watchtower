// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createInitialGameState } from '../domain/game'
import PracticePage from './PracticePage.vue'

const api = vi.hoisted(() => ({ submit: vi.fn(), addToStatistics: vi.fn(), matches: [] as unknown[] }))
vi.mock('../services/sharedMatch', () => ({ listMatchSessions: vi.fn(async () => []) }))
vi.mock('../services/localMatches', () => ({ loadLocalMatches: () => api.matches }))
vi.mock('../services/submitLocalMatch', () => ({ submitLocalMatch: api.submit, addPracticeMatchToStatistics: api.addToStatistics }))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

describe('practice page', () => {
  it('starts a practice game and submits a finished one as a new game for the team statistics', async () => {
    const game = createInitialGameState()
    game.teams = [{ id: 'home', name: 'X12-1', color: '#000' }, { id: 'away', name: 'M16-1', club: 'Vrienden', color: '#000' }]
    game.matchInfo = { id: 'practice-1', date: '2026-11-15', startTime: '19:00', venue: '', startsAt: '2026-11-15T18:00:00Z', kind: 'practice' }
    api.matches = [{ id: 'local', finishedAt: '2026-11-15T20:00:00Z', game }]
    const start = vi.fn()
    app = createApp({ render: () => h(PracticePage, { configured: true, hasCurrentGame: false, displayName: 'Scorer', onStart: start }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await nextTick()
    const row = document.querySelector('.session-row')!
    expect(row.textContent).toContain('X12-1 – Vrienden M16-1')
    expect(row.querySelector('select')).toBeNull()
    ;[...document.querySelectorAll('button')].find((button) => button.textContent === 'Oefenwedstrijd starten')!.click()
    expect(start).toHaveBeenCalled()
    row.querySelector<HTMLButtonElement>('.match-sync-primary')!.click()
    await vi.waitFor(() => expect(api.addToStatistics).toHaveBeenCalledWith('local'))
    expect(api.submit).toHaveBeenCalledWith('local', null, 'Scorer')
  })
})
