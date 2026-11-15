// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import JoinSidePicker from './JoinSidePicker.vue'

vi.mock('../services/supabaseClient', () => ({ getSupabaseClient: () => null }))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

function mount(onConfirm: (side: string) => void) {
  app = createApp({
    render: () => h(JoinSidePicker, { homeName: 'MSE-1', awayName: 'VSE-1', onConfirm }),
  })
  const host = document.body.appendChild(document.createElement('div'))
  app.mount(host)
  return host
}

describe('join side picker', () => {
  it('keeps continue disabled until a team is tapped, then confirms that side', async () => {
    const onConfirm = vi.fn()
    const host = mount(onConfirm)
    const continueButton = [...host.querySelectorAll('button')].find((button) => button.classList.contains('match-sync-primary'))!
    expect(continueButton.disabled).toBe(true)

    const options = host.querySelectorAll<HTMLButtonElement>('.join-side-option')
    options[1].click()
    await nextTick()
    expect(options[1].classList.contains('is-selected')).toBe(true)
    expect(options[0].classList.contains('is-other')).toBe(true)
    expect(continueButton.disabled).toBe(false)

    continueButton.click()
    expect(onConfirm).toHaveBeenCalledWith('away')
  })
})
