// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import type { GameAction, RecentAction, Team } from '../domain/game'
import ActivityPanel from './ActivityPanel.vue'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

describe('activity entries', () => {
  it('animates newly inserted entries in their team color without reanimating existing entries', async () => {
    const teams: Team[] = [
      { id: 'home', name: 'Home team', color: '#f26a36' },
      { id: 'away', name: 'Away team', color: '#5d72d9' },
    ]
    const action = (id: string, teamId: string, createdAt: number): GameAction => ({
      id, teamId, createdAt, playerId: teamId === 'home' ? 'p1' : null, type: 'score', value: 1,
    })
    const recent = ref<RecentAction[]>([{ action: action('old', 'home', 1), assistName: '' }])
    app = createApp({
      render: () => h(ActivityPanel, {
        teams, recentActions: recent.value, timeline: [], youth: false, teamStats: [], players: [],
        playerName: () => 'Alex', canUndo: true, playerFouls: {},
      }),
    })
    app.mount(document.body.appendChild(document.createElement('div')))
    await nextTick()
    const old = document.querySelector<HTMLElement>('.activity-row')!
    expect(old.classList.contains('activity-enter-active')).toBe(false)
    recent.value = [
      { action: action('new', 'away', 2), assistName: '' },
      { action: action('old', 'home', 1), assistName: '' },
    ]
    await nextTick()
    const rows = document.querySelectorAll<HTMLElement>('.activity-row')
    expect(rows[0]?.classList.contains('activity-enter-active')).toBe(true)
    expect(rows[0]?.style.getPropertyValue('--activity-color')).toBe('#5d72d9')
    expect(rows[1]).toBe(old)
    expect(old.classList.contains('activity-enter-active')).toBe(false)
  })
})
