// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import BaseDialog from './BaseDialog.vue'

const apps: App[] = []

function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render })
  app.mount(root)
  apps.push(app)
}

function press(key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('dialog accessibility', () => {
  it('keeps focus inside a modal and returns focus to its opener', async () => {
    const rect = new DOMRect(0, 0, 10, 10)
    const rects = Object.assign([rect], {
      item: (index: number) => index === 0 ? rect : null,
    })
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(rects)
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const open = ref(true)
    mount(() => open.value
      ? h(BaseDialog, {
          backdropClass: 'backdrop',
          dialogClass: 'dialog',
          label: 'Test',
          onClose: () => { open.value = false },
        }, {
          default: () => [
            h('button', { id: 'first' }, 'First'),
            h('button', { disabled: true }, 'Disabled'),
            h('button', { id: 'last' }, 'Last'),
          ],
        })
      : h('div'))
    await nextTick()
    const dialog = document.querySelector<HTMLElement>('.dialog')!
    const first = document.querySelector<HTMLElement>('#first')!
    const last = document.querySelector<HTMLElement>('#last')!
    expect(document.activeElement).toBe(dialog)
    expect(press('Tab', true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
    expect(press('Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    opener.focus()
    expect(document.activeElement).toBe(dialog)
    expect(press('Escape').defaultPrevented).toBe(true)
    await nextTick()
    expect(document.activeElement).toBe(opener)
  })

  it('closes only the modal when a non-modal page is mounted behind it', async () => {
    const modalOpen = ref(true)
    const pageOpen = ref(false)
    const pageClose = vi.fn()
    mount(() => h('div', [
      modalOpen.value
        ? h(BaseDialog, { backdropClass: 'modal-backdrop', dialogClass: 'modal', onClose: () => { modalOpen.value = false } })
        : null,
      pageOpen.value
        ? h(BaseDialog, { backdropClass: 'page', dialogClass: 'content', modal: false, onClose: pageClose })
        : null,
    ]))
    await nextTick()
    pageOpen.value = true
    await nextTick()
    press('Escape')
    await nextTick()
    expect(document.querySelector('.modal')).toBeNull()
    expect(pageClose).not.toHaveBeenCalled()
    press('Escape')
    expect(pageClose).toHaveBeenCalledOnce()
  })

  it('respects backdrop and Escape closing options', async () => {
    const close = vi.fn()
    const backdrop = ref(false)
    const escape = ref(false)
    mount(() => h(BaseDialog, {
      backdropClass: 'backdrop',
      dialogClass: 'dialog',
      closeOnBackdrop: backdrop.value,
      closeOnEscape: escape.value,
      onClose: close,
    }))
    await nextTick()
    const overlay = document.querySelector<HTMLElement>('.backdrop')!
    overlay.click()
    press('Escape')
    expect(close).not.toHaveBeenCalled()
    backdrop.value = true
    escape.value = true
    await nextTick()
    document.querySelector<HTMLElement>('.dialog')!.click()
    expect(close).not.toHaveBeenCalled()
    overlay.click()
    press('Escape')
    expect(close).toHaveBeenCalledTimes(2)
  })
})
