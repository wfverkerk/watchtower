// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import Scoreboard from './Scoreboard.vue'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

describe('scoreboard teams', () => {
  it('shows the club above the team name of a typed practice opponent', () => {
    app = createApp({
      render: () => h(Scoreboard, {
        teams: [{ id: 'home', name: 'X12-1', color: '#f26a36' }, { id: 'away', name: 'M16-1', club: 'Onbekende Club', color: '#5d72d9' }],
        scores: [{ id: 'home', points: 0 }, { id: 'away', points: 0 }],
        scoreNotification: null,
        gameStarted: false, canStart: true, canStartNewMatch: false, youth: false, teamFouls: {},
      }),
    })
    app.mount(document.body.appendChild(document.createElement('div')))
    const away = document.querySelector<HTMLElement>('.away-score')!
    expect(away.querySelector('.team-club')?.textContent).toBe('Onbekende Club')
    expect(away.querySelector('input')?.value).toBe('M16-1')
    expect(document.querySelector('.home-score .team-club')).toBeNull()
  })

  it('keeps names, foul markers and score notifications on their own side', async () => {
    const change = vi.fn()
    const notification = ref<{ id: number; teamId: string; value: 1 | 2 | 3 } | null>(null)
    app = createApp({
      render: () => h(Scoreboard, {
        teams: [{ id: 'home', name: 'A', color: '#f26a36' }, { id: 'away', name: 'B', color: '#5d72d9' }],
        scores: [{ id: 'home', points: 2 }, { id: 'away', points: 3 }],
        scoreNotification: notification.value,
        gameStarted: true, canStart: true, canStartNewMatch: false, youth: false,
        teamFouls: { home: 5, away: 4 },
        onTeamNameChange: change,
      }),
    })
    app.mount(document.body.appendChild(document.createElement('div')))
    const home = document.querySelector<HTMLElement>('.home-score')!
    const away = document.querySelector<HTMLElement>('.away-score')!
    expect(home.querySelector('strong')?.textContent).toBe('2')
    expect(away.querySelector('strong')?.textContent).toBe('3')
    expect(home.querySelector('.foul-marker')).not.toBeNull()
    expect(away.querySelector('.foul-marker')).toBeNull()
    const input = away.querySelector('input')!
    input.value = 'Changed'
    input.dispatchEvent(new Event('input'))
    expect(change).toHaveBeenCalledWith('away', 'Changed')

    notification.value = { id: 1, teamId: 'away', value: 3 }
    await nextTick()
    expect(home.querySelector('.score-increment')).toBeNull()
    expect(away.querySelector('.score-increment')?.textContent).toBe('+3')
    away.querySelector('.score-increment')?.dispatchEvent(new Event('animationend'))
    await nextTick()
    expect(away.querySelector('.score-increment')).toBeNull()
  })

  it('shows the quarter between the scores, or the number for youth games', () => {
    const render = (youth: boolean, period: number) => {
      app?.unmount()
      app = createApp({
        render: () => h(Scoreboard, {
          teams: [{ id: 'home', name: 'A', color: '#f26a36' }, { id: 'away', name: 'B', color: '#5d72d9' }],
          scores: [{ id: 'home', points: 0 }, { id: 'away', points: 0 }],
          scoreNotification: null, gameStarted: true, canStart: true, canStartNewMatch: false,
          youth, period, teamFouls: {},
        }),
      })
      app.mount(document.body.appendChild(document.createElement('div')))
      return document.querySelector('.score-period')?.textContent
    }
    expect(render(false, 2)).toBe('Q2')
    expect(render(true, 3)).toBe('3')
  })

  it('emits the chosen team color for that team', async () => {
    const change = vi.fn()
    app = createApp({
      render: () => h(Scoreboard, {
        teams: [{ id: 'home', name: 'A', color: '#f26a36' }, { id: 'away', name: 'B', color: '#5d72d9' }],
        scores: [{ id: 'home', points: 0 }, { id: 'away', points: 0 }],
        scoreNotification: null, gameStarted: false, canStart: true, canStartNewMatch: false, youth: false, teamFouls: {},
        onTeamColorChange: change,
      }),
    })
    app.mount(document.body.appendChild(document.createElement('div')))
    document.querySelector<HTMLButtonElement>('.away-score .team-color-button')!.click()
    await nextTick()
    document.querySelector<HTMLButtonElement>('.away-score button[aria-label="#2fa37a"]')!.click()
    expect(change).toHaveBeenCalledWith('away', '#2fa37a')
  })

  it('does not offer a color choice for a Zoebas team', () => {
    app = createApp({
      render: () => h(Scoreboard, {
        teams: [{ id: 'home', name: 'X12-1', color: '#f26a36', zoebas: true }, { id: 'away', name: 'X12-2', color: '#b8431c', zoebas: true }],
        scores: [{ id: 'home', points: 0 }, { id: 'away', points: 0 }],
        scoreNotification: null, gameStarted: false, canStart: true, canStartNewMatch: false, youth: false, teamFouls: {},
      }),
    })
    app.mount(document.body.appendChild(document.createElement('div')))
    expect(document.querySelector('.away-score button.team-color-button')).toBeNull()
  })
})
