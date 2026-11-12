// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import type { UserProfile } from '../services/userProfile'
import UserProfileDialog from './UserProfileDialog.vue'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

describe('profile settings', () => {
  it('shows the current build in settings but not during onboarding', async () => {
    const profile = ref<UserProfile | null>(null)
    app = createApp({
      render: () => h(UserProfileDialog, { profile: profile.value, teams: [], error: '', theme: 'light' }),
    })
    app.mount(document.body.appendChild(document.createElement('div')))
    expect(document.querySelector('.profile-build-id')).toBeNull()
    profile.value = { name: 'Jamie', description: '', locale: 'nl', keepScreenAwake: true }
    await nextTick()
    expect(document.querySelector('.profile-build-id')?.textContent).toBe(`Build: ${__BUILD_ID__}`)
  })
})
