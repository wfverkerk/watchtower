// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App, type Ref } from 'vue'
import { useScreenWakeLock } from './useScreenWakeLock'

let app: App | undefined

function mount(enabled: Ref<boolean>) {
  let status: ReturnType<typeof useScreenWakeLock> | undefined
  app = createApp({
    setup() {
      status = useScreenWakeLock(enabled)
      return () => h('div')
    },
  })
  app.mount(document.createElement('div'))
  return status!
}

function makeLock() {
  const lock = new EventTarget()
  return Object.assign(lock, {
    released: false,
    type: 'screen' as const,
    release: vi.fn(async () => { lock.dispatchEvent(new Event('release')) }),
    onrelease: null,
  })
}

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('screen wake lock', () => {
  it('holds the lock only while enabled and visible, and reacquires on return', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const first = makeLock()
    const second = makeLock()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    vi.stubGlobal('navigator', { wakeLock: { request } })
    const enabled = ref(true)
    const status = mount(enabled)
    await settle()
    expect(status.value).toBe('active')
    expect(request).toHaveBeenCalledTimes(1)

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(first.release).toHaveBeenCalledOnce()
    expect(status.value).toBe('idle')

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    expect(status.value).toBe('active')
    enabled.value = false
    await settle()
    expect(second.release).toHaveBeenCalledOnce()
    expect(status.value).toBe('idle')
  })

  it('releases a request that resolves after the game is paused', async () => {
    let resolveRequest!: (lock: ReturnType<typeof makeLock>) => void
    const request = vi.fn(() => new Promise<ReturnType<typeof makeLock>>((resolve) => { resolveRequest = resolve }))
    vi.stubGlobal('navigator', { wakeLock: { request } })
    const enabled = ref(true)
    const status = mount(enabled)
    enabled.value = false
    await nextTick()
    const lock = makeLock()
    resolveRequest(lock)
    await settle()
    expect(lock.release).toHaveBeenCalledOnce()
    expect(status.value).toBe('idle')
  })

  it('reports unsupported or denied requests', async () => {
    vi.stubGlobal('navigator', {})
    const status = mount(ref(true))
    expect(status.value).toBe('unsupported')
    app?.unmount()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('navigator', { wakeLock: { request: vi.fn().mockRejectedValue(new Error('denied')) } })
    const denied = mount(ref(true))
    await settle()
    expect(denied.value).toBe('error')
    expect(log).toHaveBeenCalledOnce()
  })
})
