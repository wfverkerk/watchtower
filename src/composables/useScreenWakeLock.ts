import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

export function useScreenWakeLock(enabled: Readonly<Ref<boolean>>) {
  const status = ref<'idle' | 'active' | 'unsupported' | 'error'>('idle')
  let sentinel: WakeLockSentinel | null = null
  let pending = false
  let revision = 0
  let mounted = false

  function shouldHold() {
    return mounted && enabled.value && document.visibilityState === 'visible'
  }

  async function release(lock: WakeLockSentinel) {
    try {
      await lock.release()
    } catch (error) {
      console.error('Failed to release screen wake lock.', error)
    }
  }

  async function reconcile() {
    revision++
    const requestRevision = revision
    if (!shouldHold()) {
      const previous = sentinel
      sentinel = null
      status.value = 'idle'
      if (previous) await release(previous)
      return
    }
    if (!('wakeLock' in navigator)) {
      status.value = 'unsupported'
      return
    }
    if (sentinel || pending) return

    pending = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (requestRevision !== revision || !shouldHold()) {
        await release(lock)
      } else {
        sentinel = lock
        status.value = 'active'
        lock.addEventListener('release', () => {
          if (sentinel === lock) {
            sentinel = null
            status.value = shouldHold() ? 'error' : 'idle'
          }
        })
      }
    } catch (error) {
      if (requestRevision === revision && shouldHold()) {
        console.error('Failed to keep the screen awake.', error)
        status.value = 'error'
      }
    } finally {
      pending = false
      if (requestRevision !== revision && shouldHold() && !sentinel) void reconcile()
    }
  }

  const onVisibilityChange = () => { void reconcile() }
  watch(enabled, () => { if (mounted) void reconcile() })
  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', onVisibilityChange)
    void reconcile()
  })
  onUnmounted(() => {
    mounted = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    void reconcile()
  })

  return status
}
