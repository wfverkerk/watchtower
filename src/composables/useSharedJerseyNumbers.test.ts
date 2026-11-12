import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { loadJerseyNumbers, saveJerseyNumbers } from '../services/jerseyNumbers'
import type { TeamProfile } from '../services/teamProfiles'
import type { ZoebasTeam } from '../services/zoebasTeams'
import { useSharedJerseyNumbers } from './useSharedJerseyNumbers'

vi.mock('../services/jerseyNumbers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/jerseyNumbers')>()
  return { ...original, loadJerseyNumbers: vi.fn(), saveJerseyNumbers: vi.fn() }
})

const team: ZoebasTeam = {
  id: 'team',
  name: 'Team',
  sourceTeamId: 'source',
  playerNames: ['Sam', 'Sam'],
  staff: [],
}

function profile(): TeamProfile {
  return {
    id: 'profile',
    name: 'Team',
    catalogTeamId: team.id,
    players: [
      { id: 'a', name: 'Sam', catalogName: 'Sam', jerseyNumber: '1', isParticipating: true, isOnCourt: true },
      { id: 'b', name: 'Sam', catalogName: 'Sam', jerseyNumber: '2', isParticipating: true, isOnCourt: false },
      { id: 'local', name: 'Local', jerseyNumber: '9', isParticipating: true, isOnCourt: false },
    ],
    coaches: [],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('shared jersey number workflow', () => {
  it('reconciles wizard drafts and saves against the current shared baseline', async () => {
    const draft = ref(profile())
    draft.value.players[0].jerseyNumber = '4'
    vi.mocked(loadJerseyNumbers).mockResolvedValue([{ position: 1, name: 'Sam', number: '1' }])
    const jersey = useSharedJerseyNumbers({
      getProfile: () => draft.value,
      getTeam: () => team,
      catalogPlayerIds: ref(['a', 'b']),
      initialBaselines: { team: [{ position: 1, name: 'Sam', number: '1' }] },
      restoredDraft: true,
    })

    await jersey.load(team, false)
    expect(draft.value.players.map((player) => player.jerseyNumber)).toEqual(['4', '2', '9'])
    expect(await jersey.save()).toBe(true)
    expect(saveJerseyNumbers).toHaveBeenCalledWith('team', [
      { position: 1, name: 'Sam', expected: '1', number: '4' },
      { position: 2, name: 'Sam', expected: null, number: '2' },
    ])
    expect(jersey.baselines.value.team).toEqual([
      { position: 1, name: 'Sam', number: '4' },
      { position: 2, name: 'Sam', number: '2' },
    ])
  })

  it('keeps conflicting wizard edits until explicit reload and ignores stale requests', async () => {
    const draft = ref(profile())
    draft.value.players[0].jerseyNumber = '4'
    vi.mocked(loadJerseyNumbers).mockResolvedValue([{ position: 1, name: 'Sam', number: '3' }])
    const jersey = useSharedJerseyNumbers({
      getProfile: () => draft.value,
      getTeam: () => team,
      catalogPlayerIds: ref(['a', 'b']),
      initialBaselines: { team: [{ position: 1, name: 'Sam', number: '1' }] },
      restoredDraft: true,
    })

    await jersey.load(team, false)
    expect(jersey.error.value).toBeTruthy()
    expect(draft.value.players[0].jerseyNumber).toBe('4')
    await jersey.reload()
    expect(jersey.error.value).toBe('')
    expect(draft.value.players.map((player) => player.jerseyNumber)).toEqual(['3', '', '9'])

    let finish!: (value: { position: number; name: string; number: string }[]) => void
    vi.mocked(loadJerseyNumbers).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = jersey.load(team, true)
    jersey.reset()
    finish([{ position: 1, name: 'Sam', number: '8' }])
    await pending
    expect(draft.value.players[0].jerseyNumber).toBe('3')
    expect(jersey.loading.value).toBe(false)
  })

  it('saves only changed catalog players against the game baseline, including duplicate names', async () => {
    const original = profile()
    const draft = ref(structuredClone(original))
    const jersey = useSharedJerseyNumbers({
      rosterProfile: original,
      getProfile: () => draft.value,
      getTeam: () => team,
      catalogPlayerIds: ref([]),
      restoredDraft: false,
    })
    draft.value.players[1].jerseyNumber = '08'
    draft.value.players[2].jerseyNumber = '7'

    expect(await jersey.save()).toBe(true)
    expect(saveJerseyNumbers).toHaveBeenCalledWith('team', [
      { position: 2, name: 'Sam', expected: '2', number: '08' },
    ])
    vi.mocked(saveJerseyNumbers).mockClear()
    expect(await jersey.save()).toBe(true)
    expect(saveJerseyNumbers).not.toHaveBeenCalled()
  })

  it('reports save conflicts and updates game baselines only after a successful reload', async () => {
    const original = profile()
    const draft = ref(structuredClone(original))
    const jersey = useSharedJerseyNumbers({
      rosterProfile: original,
      getProfile: () => draft.value,
      getTeam: () => team,
      catalogPlayerIds: ref([]),
      restoredDraft: false,
    })
    draft.value.players[0].jerseyNumber = '4'
    vi.mocked(saveJerseyNumbers).mockRejectedValueOnce(new Error('conflict'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await jersey.save()).toBe(false)
      expect(jersey.error.value).toBeTruthy()
      expect(draft.value.players[0].jerseyNumber).toBe('4')
      vi.mocked(loadJerseyNumbers).mockResolvedValue([{ position: 1, name: 'Sam', number: '3' }])
      await jersey.reload()
      expect(draft.value.players.map((player) => player.jerseyNumber)).toEqual(['3', '', '9'])
      draft.value.players[0].jerseyNumber = '5'
      expect(await jersey.save()).toBe(true)
      expect(saveJerseyNumbers).toHaveBeenLastCalledWith('team', [
        { position: 1, name: 'Sam', expected: '3', number: '5' },
      ])
    } finally {
      log.mockRestore()
    }
  })

  it('rejects a changed game player missing from the catalog without saving', async () => {
    const original = profile()
    const draft = ref(structuredClone(original))
    const jersey = useSharedJerseyNumbers({
      rosterProfile: original,
      getProfile: () => draft.value,
      getTeam: () => ({ ...team, playerNames: ['Sam'] }),
      catalogPlayerIds: ref([]),
      restoredDraft: false,
    })
    draft.value.players[1].jerseyNumber = '4'
    expect(await jersey.save()).toBe(false)
    expect(jersey.error.value).toBeTruthy()
    expect(saveJerseyNumbers).not.toHaveBeenCalled()
  })

  it('reports a failed reload without replacing game edits or their baseline', async () => {
    const original = profile()
    const draft = ref(structuredClone(original))
    const jersey = useSharedJerseyNumbers({
      rosterProfile: original,
      getProfile: () => draft.value,
      getTeam: () => team,
      catalogPlayerIds: ref([]),
      restoredDraft: false,
    })
    draft.value.players[0].jerseyNumber = '4'
    vi.mocked(loadJerseyNumbers).mockRejectedValueOnce(new Error('offline'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await jersey.reload()
      expect(jersey.error.value).toBeTruthy()
      expect(draft.value.players[0].jerseyNumber).toBe('4')
      expect(await jersey.save()).toBe(true)
      expect(saveJerseyNumbers).toHaveBeenCalledWith('team', [
        { position: 1, name: 'Sam', expected: '1', number: '4' },
      ])
    } finally {
      log.mockRestore()
    }
  })
})
