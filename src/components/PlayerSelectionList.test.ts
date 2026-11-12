// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import type { Player } from '../domain/game'
import PlayerSelectionList from './PlayerSelectionList.vue'

const players: Player[] = Array.from({ length: 6 }, (_, index) => ({
  id: `p${index + 1}`,
  name: `Player ${index + 1}`,
  teamId: 'home',
  jerseyNumber: String(index + 1),
  isOnCourt: true,
}))
let app: App | undefined

afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

describe('player selection list', () => {
  it('keeps selected players available at the lineup limit', async () => {
    const selected = ref(players.slice(0, 5).map((player) => player.id))
    const select = vi.fn()
    app = createApp({
      render: () => h(PlayerSelectionList, { players, playerFouls: {}, selectedIds: selected.value, maxSelections: 5, onSelect: select }),
    })
    app.mount(document.body.appendChild(document.createElement('div')))
    let buttons = document.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(buttons[0]?.disabled).toBe(false)
    expect(buttons[5]?.disabled).toBe(true)
    buttons[0]?.click()
    expect(select).toHaveBeenCalledWith('p1')
    selected.value = selected.value.slice(1)
    await nextTick()
    buttons = document.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons[5]?.disabled).toBe(false)
  })

  it('maps the scorer to no assist without losing other selection state', async () => {
    const selected = ref(['none'])
    const select = vi.fn()
    app = createApp({
      render: () => h(PlayerSelectionList, { players: players.slice(0, 2), playerFouls: {}, selectedIds: selected.value, noAssistPlayerId: 'p1', onSelect: select }),
    })
    app.mount(document.body.appendChild(document.createElement('div')))
    const buttons = document.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons[0]?.textContent).toContain('Geen assist')
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true')
    buttons[0]?.click()
    buttons[1]?.click()
    expect(select.mock.calls).toEqual([['none'], ['p2']])
    selected.value = ['p2']
    await nextTick()
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false')
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true')
  })
})
