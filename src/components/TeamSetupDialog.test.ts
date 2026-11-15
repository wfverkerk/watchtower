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
    }
    app = createApp({ render: () => h(TeamSetupDialog, {
      profiles: [profile, { id: 'away', name: 'Away', players: [] }],
      selectedProfileIds: ['profile', 'away'],
      catalogTeams: [{ id: 'team', name: 'Team', sourceTeamId: 'source', playerNames: ['Public'] }],
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

  it('asks for the opponent players instead of a scheduled match in a practice game', async () => {
    let saved: unknown[] | undefined
    app = createApp({ render: () => h(TeamSetupDialog, {
      profiles: [], selectedProfileIds: ['', ''],
      catalogTeams: [{ id: 'team', name: 'Team', sourceTeamId: 'source', playerNames: ['Anna', 'Bob'] }],
      catalogLoading: false, catalogError: '', catalogCached: true, practice: true,
      canCancel: true, error: '', onSave: (...args: unknown[]) => { saved = args },
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    const fill = (input: HTMLInputElement, value: string) => {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    expect(document.querySelector('#local-team-name')).toBeNull()
    document.querySelector<HTMLButtonElement>('.team-setup-team-grid button')!.click()
    await nextTick()
    const next = () => document.querySelector<HTMLButtonElement>('.team-setup-primary')!
    await vi.waitFor(() => expect(next().disabled).toBe(false))
    next().click()
    await nextTick()
    const numbers = document.querySelectorAll<HTMLInputElement>('input[aria-label="Nr."]')
    fill(numbers[0], '4')
    fill(numbers[1], '5')
    await nextTick()
    next().click()
    await vi.waitFor(() => expect(document.querySelector('.team-setup-matches input[placeholder="Club tegenstander"]')).not.toBeNull())
    const section = document.querySelector('.team-setup-matches')!
    expect(section.querySelector('input[type="datetime-local"]')).toBeNull()
    const opponentNames = () => [...section.querySelectorAll<HTMLInputElement>('input[aria-label="Naam speler"]')]
    const opponentNumbers = () => [...section.querySelectorAll<HTMLInputElement>('input[aria-label="Nr."]')]
    expect(opponentNames().map((input) => input.value)).toEqual(['Speler 4', 'Speler 5', 'Speler 6', 'Speler 7', 'Speler 8'])
    expect(opponentNumbers().map((input) => input.value)).toEqual(['4', '5', '6', '7', '8'])
    expect(next().disabled).toBe(true)
    fill(section.querySelector<HTMLInputElement>('input[placeholder="Club tegenstander"]')!, 'Vrienden')
    fill(section.querySelector<HTMLInputElement>('input[placeholder="Bijv. M16-1"]')!, 'M16-1')
    await nextTick()
    expect(next().disabled).toBe(false)
    fill(opponentNames()[0], 'Carla')
    fill(opponentNumbers()[0], '5')
    await nextTick()
    expect(next().disabled).toBe(true)
    fill(opponentNumbers()[0], '10')
    for (const remove of [...section.querySelectorAll<HTMLButtonElement>('.team-setup-opponent-remove')].slice(2)) remove.click()
    await nextTick()
    expect(next().disabled).toBe(false)
    next().click()
    expect(saved?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({
      name: 'M16-1',
      players: [
        expect.objectContaining({ name: 'Carla', jerseyNumber: '10', isParticipating: true }),
        expect.objectContaining({ name: 'Speler 5', jerseyNumber: '5', isParticipating: true }),
      ],
    })]))
    expect(saved?.[3]).toBe('M16-1')
    expect(saved?.[5]).toBe('Vrienden')
    expect(saved?.[2]).toBeNull()
    expect(saved?.[4]).toBe('')
  })

  it('groups the club teams in the same sections as the favorite team picker', async () => {
    const team = (id: string, name: string) => ({ id, name, sourceTeamId: id, playerNames: ['Anna'], staff: [] })
    app = createApp({ render: () => h(TeamSetupDialog, {
      profiles: [], selectedProfileIds: ['', ''],
      catalogTeams: [team('mse-1', 'MSE-1'), team('m16-1', 'M16-1'), team('x12-2', 'X12-2'), team('x12-1', 'X12-1')],
      catalogLoading: false, catalogError: '', catalogCached: true, canCancel: false, error: '',
    }) })
    app.mount(document.body.appendChild(document.createElement('div')))
    const sections = [...document.querySelectorAll('.favorite-team-section')].map((section) => [
      section.querySelector('h3')?.textContent,
      [...section.querySelectorAll('button')].map((button) => button.textContent),
    ])
    expect(sections).toEqual([['Jeugd', ['X12-1', 'X12-2']], ['14 t/m 18', ['M16-1']], ['Volwassenen', ['MSE-1']]])
  })
})
