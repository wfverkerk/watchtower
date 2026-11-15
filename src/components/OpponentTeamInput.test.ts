// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import OpponentTeamInput from './OpponentTeamInput.vue'

vi.mock('../services/supabaseClient', () => ({
  getSupabaseClient: () => ({ storage: { from: () => ({ getPublicUrl: (file: string) => ({ data: { publicUrl: `https://cdn.test/logos/${encodeURIComponent(file)}` } }) }) } }),
}))

const teams = [
  { id: '1', name: 'Apollo Amsterdam', logoFile: 'APOLLO AMSTERDAM.png' },
  { id: '2', name: 'Bc Apollo', logoFile: null },
  { id: '3', name: 'Rap', logoFile: 'RAP.gif' },
]

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

function mount() {
  const name = ref('')
  const picked = vi.fn()
  app = createApp({ render: () => h(OpponentTeamInput, {
    modelValue: name.value, teams, label: 'Naam tegenstander', onPick: picked,
    'onUpdate:modelValue': (value: string) => { name.value = value },
  }) })
  app.mount(document.body.appendChild(document.createElement('div')))
  const input = document.querySelector<HTMLInputElement>('input')!
  const type = async (value: string) => { input.focus(); input.value = value; input.dispatchEvent(new Event('input')); await nextTick() }
  return { name, picked, input, type }
}

describe('opponent team input', () => {
  it('suggests teams with logos, supports the keyboard and keeps free text for unknown teams', async () => {
    const { name, picked, input, type } = mount()
    await type('apo')
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Apollo Amsterdam', 'Bc Apollo'])
    expect(options[0].querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/logos/APOLLO%20AMSTERDAM.png')
    expect(options[1].querySelector('img')).toBeNull()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()
    expect(picked).toHaveBeenCalledWith(teams[0])
    expect(name.value).toBe('Apollo Amsterdam')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(document.querySelector('.opponent-input-control img')).not.toBeNull()

    await type('Onbekend Team')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(name.value).toBe('Onbekend Team')
    expect(picked).toHaveBeenCalledTimes(1)
  })

  it('selects with a click and closes on Escape', async () => {
    const { name, type, input } = mount()
    await type('rap')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    await type('ra')
    document.querySelector<HTMLElement>('[role="option"]')!.click()
    await nextTick()
    expect(name.value).toBe('Rap')
  })
})
