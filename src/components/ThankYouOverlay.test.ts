// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'
import ThankYouOverlay from './ThankYouOverlay.vue'

let app: App | undefined
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.useRealTimers()
})

function mount(done: () => void) {
  app = createApp({ render: () => h(ThankYouOverlay, {
    teams: [{ id: 'home', name: 'Zoebas', points: 52 }, { id: 'away', name: 'Rivalen', points: 48 }], onDone: done,
  }) })
  app.mount(document.body.appendChild(document.createElement('div')))
}

describe('thank you overlay', () => {
  it('covers the screen with the final score, locks scrolling and ends by itself', () => {
    const done = vi.fn()
    mount(done)
    const overlay = document.querySelector('.thanks-overlay')!
    expect(overlay.getAttribute('role')).toBe('dialog')
    expect(overlay.textContent).toContain('Bedankt!')
    expect(overlay.textContent).toContain('Zoebas 52 – 48 Rivalen')
    expect(document.body.style.overflow).toBe('hidden')
    vi.advanceTimersByTime(6400)
    expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(done).toHaveBeenCalledTimes(1)
    app!.unmount()
    app = undefined
    expect(document.body.style.overflow).toBe('')
  })

  it('can be skipped with a tap or Escape, and only reports once', () => {
    const done = vi.fn()
    mount(done)
    document.querySelector<HTMLElement>('.thanks-overlay')!.click()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    document.querySelector<HTMLButtonElement>('.thanks-skip')!.click()
    expect(done).toHaveBeenCalledTimes(1)
  })
})
