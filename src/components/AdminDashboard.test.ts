// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import AdminDashboard from './AdminDashboard.vue'
import { loadAdminDashboard, setTeamCoach } from '../services/admin'

vi.mock('../services/admin', () => ({
  loadAdminDashboard: vi.fn(async () => [{
    id: 'x12-1', name: 'X12-1',
    coaches: [{ userId: 'u1', email: 'coach@test.dev', rights: ['finalise_review'] }],
  }]),
  setTeamCoach: vi.fn(async () => undefined),
  removeTeamCoach: vi.fn(async () => undefined),
}))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('admin dashboard', () => {
  it('saves the coach rights with the toggled right', async () => {
    app = createApp({ render: () => h(AdminDashboard, { onClose: () => undefined }) })
    const host = document.body.appendChild(document.createElement('div'))
    app.mount(host)
    await vi.waitFor(() => expect(host.textContent).toContain('coach@test.dev'))
    const manage = host.querySelectorAll<HTMLInputElement>('.admin-coach input[type="checkbox"]')[1]
    manage.click()
    await nextTick()
    expect(setTeamCoach).toHaveBeenCalledWith('x12-1', 'coach@test.dev', ['finalise_review', 'manage_coaches'])
    expect(loadAdminDashboard).toHaveBeenCalled()
  })
})
