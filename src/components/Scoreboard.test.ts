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
  it('keeps names, foul markers and score notifications on their own side', async () => {
    const change = vi.fn()
    const notification = ref<{ id: number; teamId: string; value: 1 | 2 | 3 } | null>(null)
    app = createApp({
      render: () => h(Scoreboard, {
        teams: [{ id: 'home', name: 'A', color: '#f26a36' }, { id: 'away', name: 'B', color: '#5d72d9' }],
        scores: [{ id: 'home', points: 2 }, { id: 'away', points: 3 }],
        scoreNotification: notification.value,
        gameStarted: true, canStart: true, canStartNewMatch: false, youth: false,
        clockDisplay: '10:00', clockRunning: false, clockAvailable: true,
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
})
