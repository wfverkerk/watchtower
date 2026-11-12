import { ref, type Ref } from 'vue'
import { useLocale } from '../i18n/useLocale'
import { loadJerseyNumbers, reconcileJerseyNumbers, saveJerseyNumbers, type JerseyChange, type JerseyNumber } from '../services/jerseyNumbers'
import type { TeamProfile, TeamProfilePlayer } from '../services/teamProfiles'
import type { ZoebasTeam } from '../services/zoebasTeams'

type CatalogPlayer = { name: string; position: number; player: TeamProfilePlayer }

export function useSharedJerseyNumbers(options: {
  rosterProfile?: TeamProfile
  getProfile: () => TeamProfile | null
  getTeam: () => ZoebasTeam | undefined
  catalogPlayerIds: Ref<string[]>
  initialBaselines?: Record<string, JerseyNumber[]>
  restoredDraft: boolean
}) {
  const { t } = useLocale()
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const baselines = ref<Record<string, JerseyNumber[]>>(options.initialBaselines ?? {})
  const numbers = ref<JerseyNumber[]>([])
  const rosterBaseline = new Map(options.rosterProfile?.players.map((player) => [player.id, player.jerseyNumber]) ?? [])
  const initializedTeams = new Set<string>()
  let request = 0

  function catalogPlayers(team: ZoebasTeam, profile: TeamProfile): CatalogPlayer[] {
    if (!options.rosterProfile) {
      return options.catalogPlayerIds.value.flatMap((id, index) => {
        const player = profile.players.find((item) => item.id === id)
        const name = team.playerNames[index]
        return player && name ? [{ name, position: index + 1, player }] : []
      })
    }
    const used = new Set<string>()
    return team.playerNames.flatMap((name, index) => {
      const player = profile.players.find((item) => !used.has(item.id) && item.catalogName === name)
      if (!player) return []
      used.add(player.id)
      return [{ name, position: index + 1, player }]
    })
  }

  function reset() {
    request++
    loading.value = false
    error.value = ''
    numbers.value = []
  }

  async function load(team: ZoebasTeam, replaceLocal: boolean) {
    const profile = options.getProfile()
    if (!profile) {
      error.value = t('teamSetup.jerseyLoadError')
      return
    }
    const currentRequest = ++request
    loading.value = true
    error.value = ''
    try {
      const shared = await loadJerseyNumbers(team.id)
      if (currentRequest !== request) return
      const players = catalogPlayers(team, profile)
      if (options.rosterProfile || replaceLocal) {
        for (const { name, position, player } of players) {
          player.jerseyNumber = shared.find((item) => item.position === position && item.name === name)?.number ?? ''
          if (options.rosterProfile) rosterBaseline.set(player.id, player.jerseyNumber)
        }
      } else {
        const local = team.playerNames.map((_, index) =>
          players.find((item) => item.position === index + 1)?.player.jerseyNumber ?? '',
        )
        const reconciled = reconcileJerseyNumbers(team.playerNames, local, shared, baselines.value[team.id], options.restoredDraft || initializedTeams.has(team.id))
        if (reconciled.conflict) {
          error.value = t('teamSetup.jerseySaveError')
          return
        }
        for (const { position, player } of players) player.jerseyNumber = reconciled.numbers[position - 1] ?? ''
      }
      if (!options.rosterProfile) {
        numbers.value = shared
        baselines.value[team.id] = shared
        initializedTeams.add(team.id)
      }
    } catch (cause) {
      console.error('Failed to load shared jersey numbers.', cause)
      if (currentRequest === request) error.value = t('teamSetup.jerseyLoadError')
    } finally {
      if (currentRequest === request) loading.value = false
    }
  }

  async function reload() {
    const team = options.getTeam()
    if (!team) {
      error.value = t('teamSetup.jerseyLoadError')
      return
    }
    await load(team, true)
  }

  async function save(): Promise<boolean> {
    const profile = options.getProfile()
    if (!profile) {
      error.value = t('teamSetup.jerseyLoadError')
      return false
    }
    const changedPlayers = options.rosterProfile
      ? profile.players.filter((player) =>
          player.catalogName && rosterBaseline.has(player.id) && player.jerseyNumber !== rosterBaseline.get(player.id),
        )
      : null
    if (changedPlayers && !changedPlayers.length) return true
    const team = options.getTeam()
    if (!team) {
      error.value = t('teamSetup.jerseyLoadError')
      return false
    }
    const players = catalogPlayers(team, profile)
    if (changedPlayers && players.filter(({ player }) => changedPlayers.includes(player)).length !== changedPlayers.length) {
      error.value = t('teamSetup.jerseyLoadError')
      return false
    }
    const changes: JerseyChange[] = players.flatMap(({ name, position, player }) => {
      if (changedPlayers && !changedPlayers.includes(player)) return []
      const expected = changedPlayers
        ? rosterBaseline.get(player.id) || null
        : numbers.value.find((item) => item.position === position && item.name === name)?.number ?? null
      const number = player.jerseyNumber || null
      return number === expected ? [] : [{ position, name, expected, number }]
    })
    saving.value = true
    error.value = ''
    try {
      await saveJerseyNumbers(team.id, changes)
      if (changedPlayers) {
        for (const player of changedPlayers) rosterBaseline.set(player.id, player.jerseyNumber)
      } else {
        for (const change of changes) {
          numbers.value = numbers.value.filter((item) => item.position !== change.position)
          if (change.number !== null) numbers.value.push({ position: change.position, name: change.name, number: change.number })
        }
        baselines.value[team.id] = numbers.value
      }
      return true
    } catch (cause) {
      console.error('Failed to save shared jersey numbers.', cause)
      error.value = t('teamSetup.jerseySaveError')
      return false
    } finally {
      saving.value = false
    }
  }

  return { loading, saving, error, baselines, reset, load, reload, save }
}
