// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import TeamLogo from './TeamLogo.vue'
import { useOpponentTeams } from '../composables/useOpponentTeams'

vi.mock('../services/supabaseClient', () => ({
  getSupabaseClient: () => ({ storage: { from: () => ({ getPublicUrl: (file: string) => ({ data: { publicUrl: `https://cdn.test/logos/${encodeURIComponent(file)}` } }) }) } }),
}))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  useOpponentTeams().teams.value = []
})

function mount(props: { name: string; placeholder?: boolean }) {
  app = createApp({ render: () => h(TeamLogo, props) })
  const host = document.body.appendChild(document.createElement('div'))
  app.mount(host)
  return host
}

describe('team logo', () => {
  it('shows the logo of a team from the shared catalog and hides it after a load error', async () => {
    useOpponentTeams().teams.value = [{ id: '1', name: 'Rap Élan', logoFile: 'RAP ELAN.png' }]
    const host = mount({ name: 'rap elan' })
    const image = host.querySelector('img')!
    expect(image.getAttribute('src')).toBe('https://cdn.test/logos/RAP%20ELAN.png')
    image.dispatchEvent(new Event('error'))
    await nextTick()
    expect(host.querySelector('img')).toBeNull()
  })

  it('renders nothing for unknown teams, or an empty slot when a placeholder is requested', () => {
    expect(mount({ name: 'Onbekend' }).querySelector('.team-logo')).toBeNull()
    document.body.replaceChildren()
    expect(mount({ name: 'Onbekend', placeholder: true }).querySelector('.team-logo-empty')).not.toBeNull()
  })
})
