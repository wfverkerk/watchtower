// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { loadTeamSetupDraft } from '../services/teamProfiles'
import TeamSetupDialog from './TeamSetupDialog.vue'

vi.mock('../services/statistics', () => ({
  loadStatisticsTeams: vi.fn(async () => [{ id: 'team', name: 'Team', isCoach: true }]),
  loadStatisticsRoster: vi.fn(async () => [{ id: 'private-id', name: 'Secret Name', jerseyNumber: '12', isPrivate: true }]),
}))
vi.mock('../services/supabaseClient', () => ({
  getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: {} }, error: null }) } }),
}))
vi.mock('../services/jerseyNumbers', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/jerseyNumbers')>(),
  loadJerseyNumbers: vi.fn(async () => []),
  saveJerseyNumbers: vi.fn(async () => {}),
}))
vi.mock('../services/opponentTeams', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/opponentTeams')>(),
  loadOpponentTeams: vi.fn(async () => []),
}))
vi.mock('../services/zoebasMatches', () => ({
  loadZoebasMatches: vi.fn(async () => []),
  getRecommendedMatch: vi.fn(() => null),
}))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  window.localStorage.clear()
})

describe('shared team roster', () => {
  it('uses a stable player ID but never inserts the private name into the match setup', async () => {
    const profile = {
      id: 'profile', name: 'Team', catalogTeamId: 'team',
      players: [{ id: 'public', name: 'Public', jerseyNumber: '1', isParticipating: true, isOnCourt: false }],
      coaches: [],
    }
    app = createApp({ render: () => h(TeamSetupDialog, {
      profiles: [profile, { id: 'away', name: 'Away', players: [], coaches: [] }],
      selectedProfileIds: ['profile', 'away'],
      catalogTeams: [{ id: 'team', name: 'Team', sourceTeamId: 'source', playerNames: ['Public'], staff: [] }],
      catalogLoading: false, catalogError: '', canCancel: false, error: '', home: true,
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Gedeelde spelerslijst gebruiken'))
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Gedeelde spelerslijst gebruiken'))!
    button.click()
    await nextTick()
    const input = [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Naam speler"]')]
      .find((item) => item.value === 'Speler 12')
    expect(input?.disabled).toBe(true)
    expect(document.body.innerHTML).not.toContain('Secret Name')
    expect(loadTeamSetupDraft()?.profiles[0].players).toContainEqual(expect.objectContaining({
      id: 'private-id', name: 'Speler 12', statisticsPrivate: true,
    }))
  })

  it('creates a local team and match without a catalog', async () => {
    let saved: unknown[] | undefined
    app = createApp({ render: () => h(TeamSetupDialog, {
      profiles: [], selectedProfileIds: ['', ''], catalogTeams: [],
      catalogLoading: false, catalogError: 'Catalogus niet beschikbaar', localOnly: true,
      canCancel: false, error: '', onSave: (...args: unknown[]) => { saved = args },
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    const fill = (input: HTMLInputElement, value: string) => {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    fill(document.querySelector<HTMLInputElement>('#local-team-name')!, 'Eigen team')
    await nextTick()
    ;[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Lokaal team toevoegen'))!.click()
    await nextTick()
    await nextTick()
    const next = () => document.querySelector<HTMLButtonElement>('.team-setup-primary')!
    expect(next().disabled).toBe(false)
    next().click()
    await nextTick()
    const names = document.querySelectorAll<HTMLInputElement>('input[aria-label="Naam speler"]')
    const numbers = document.querySelectorAll<HTMLInputElement>('input[aria-label="Nr."]')
    fill(names[0], 'Anna')
    fill(names[1], 'Bob')
    fill(numbers[0], '4')
    fill(numbers[1], '5')
    const toggles = document.querySelectorAll<HTMLButtonElement>('.team-setup-court-toggle')
    toggles[0].click()
    toggles[1].click()
    await nextTick()
    expect(next().disabled).toBe(false)
    next().click()
    await vi.waitFor(() => expect(document.querySelector('input[placeholder="Naam tegenstander"]')).not.toBeNull())
    const opponent = document.querySelector<HTMLInputElement>('input[placeholder="Naam tegenstander"]')!
    fill(opponent, 'Tegenstander')
    await nextTick()
    fill(document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!, '2026-11-13T14:30')
    await nextTick()
    expect(next().disabled).toBe(false)
    next().click()
    expect(saved).toBeDefined()
    expect(saved?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({
      name: 'Eigen team',
      catalogTeamId: expect.stringMatching(/^local-/),
      players: expect.arrayContaining([expect.objectContaining({ name: 'Anna', jerseyNumber: '4', isParticipating: true })]),
    })]))
    expect(saved?.[3]).toBe('Tegenstander')
    expect(saved?.[4]).toBe('2026-11-13T14:30')
  })
})
