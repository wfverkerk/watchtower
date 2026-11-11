<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useLocale } from '../i18n/useLocale'
import { loadTeamSetupDraft, saveTeamSetupDraft, type TeamProfile, type TeamProfileCoach, type TeamProfilePlayer, type TeamSetupDraft } from '../services/teamProfiles'
import { loadJerseyNumbers, reconcileJerseyNumbers, saveJerseyNumbers, type JerseyChange, type JerseyNumber } from '../services/jerseyNumbers'
import { getRecommendedMatch, loadZoebasMatches, type ZoebasMatch } from '../services/zoebasMatches'
import type { ZoebasTeam } from '../services/zoebasTeams'

const props = defineProps<{
  profiles: TeamProfile[]
  selectedProfileIds: [string, string]
  catalogTeams: ZoebasTeam[]
  catalogLoading: boolean
  catalogError: string
  canCancel: boolean
  error: string
  home?: boolean
  rosterProfile?: TeamProfile
  requireOnCourt?: boolean
}>()

const emit = defineEmits<{
  cancel: []
  save: [profiles: TeamProfile[], selectedProfileIds: [string, string], match: ZoebasMatch | null, manualOpponentName: string]
  'save-roster': [profile: TeamProfile]
}>()

const { t } = useLocale()
const steps = ['stepTeam', 'stepPlayers', 'stepOpponent'] as const
const step = ref(props.rosterProfile ? 1 : 0)
const furthestStep = ref(0)
const stepContent = ref<HTMLElement | null>(null)
const draftStorageError = ref('')
let draftLoadFailed = false
let restoredDraft: TeamSetupDraft | null = null
if (!props.rosterProfile) {
  try {
    restoredDraft = loadTeamSetupDraft()
  } catch (error) {
    console.error('Failed to load team setup draft.', error)
    draftStorageError.value = 'errors.loadTeams'
    draftLoadFailed = true
  }
}
const draftProfiles = ref((props.rosterProfile ? [props.rosterProfile] : restoredDraft?.profiles ?? props.profiles).map((profile) => ({
  ...profile,
  players: profile.players.map((player) => ({ ...player, isParticipating: restoredDraft || props.rosterProfile ? player.isParticipating : !!player.name.trim() })),
  coaches: (profile.coaches ?? []).map((coach) => ({ ...coach, isParticipating: coach.isParticipating ?? true })),
})))
const selected = ref<[string, string]>(props.rosterProfile
  ? [props.rosterProfile.id, props.selectedProfileIds[1]]
  : [...(restoredDraft?.selectedProfileIds ?? props.selectedProfileIds)])
const selectedCatalogTeamId = ref(
  restoredDraft?.catalogTeamId || (draftProfiles.value.find((profile) => profile.id === selected.value[0])?.catalogTeamId ?? ''),
)
const matches = ref<ZoebasMatch[]>([])
const matchLoading = ref(false)
const matchError = ref('')
const selectedMatchId = ref('')
const manualOpponentName = ref('')
const jerseyLoading = ref(false)
const jerseySaving = ref(false)
const jerseyError = ref('')
const jerseyNumbers = ref<JerseyNumber[]>([])
const jerseyBaselines = ref<Record<string, JerseyNumber[]>>(restoredDraft?.jerseyBaselines ?? {})
const catalogPlayerIds = ref<string[]>([])
const rosterJerseyBaseline = new Map(props.rosterProfile?.players.map((player) => [player.id, player.jerseyNumber]) ?? [])
const initializedTeams = new Set<string>()
const newCoachName = ref('')
const newCoachRole = ref<TeamProfileCoach['role']>('coach')
const availableTeams = computed(() => props.catalogTeams.filter((team) => team.playerNames.length > 0))
const currentProfile = computed(() =>
  draftProfiles.value.find((profile) => profile.id === selected.value[0]) ?? null,
)
const participatingPlayers = computed(() => currentProfile.value?.players.filter((player) => player.isParticipating) ?? [])
const participatingMembersCount = computed(() =>
  participatingPlayers.value.length + (currentProfile.value?.coaches.filter((coach) => coach.isParticipating).length ?? 0),
)
const selectedMatch = computed(() => matches.value.find((match) => match.id === selectedMatchId.value) ?? null)
const recommendedMatch = computed(() => getRecommendedMatch(matches.value))
const upcomingMatches = computed(() => matches.value.filter((match) =>
  new Date(`${match.date}T${match.startTime}:00`).getTime() >= Date.now(),
))
const pastMatches = computed(() => matches.value.filter((match) =>
  new Date(`${match.date}T${match.startTime}:00`).getTime() < Date.now(),
))
const hasMatchSelection = computed(() => !!selectedMatch.value || !!manualOpponentName.value.trim())

watch([draftProfiles, selected, selectedCatalogTeamId, jerseyBaselines], () => {
  if (props.rosterProfile || !selectedCatalogTeamId.value || draftLoadFailed) return
  try {
    saveTeamSetupDraft({
      profiles: draftProfiles.value,
      selectedProfileIds: selected.value,
      catalogTeamId: selectedCatalogTeamId.value,
      jerseyBaselines: jerseyBaselines.value,
    })
    draftStorageError.value = ''
  } catch (error) {
    console.error('Failed to save team setup draft.', error)
    draftStorageError.value = 'errors.saveTeams'
  }
}, { deep: true })

function selectCatalogTeam(teamId: string) {
  selectedCatalogTeamId.value = teamId
  const team = props.catalogTeams.find((item) => item.id === teamId)
  if (!team) return

  let profile = draftProfiles.value.find((item) => item.catalogTeamId === team.id)
  const legacyProfile = profile ?? draftProfiles.value.find((item) =>
      item.id === `zoebas-${team.id}`
      || (team.id === 'x12-1' && item.id === 'zoebas-x12-1')
      || item.name === team.name
      || item.name === `Zoebas ${team.name}`,
    )
  const usedPlayerIds = new Set<string>()
  const players = (team.playerNames.length ? team.playerNames : legacyProfile?.players.map(() => '') ?? Array.from({ length: 5 }, () => '')).map((name, index): TeamProfilePlayer => {
      const matchesName = (player: TeamProfilePlayer) => (player.catalogName ?? player.name).toLocaleLowerCase() === name.toLocaleLowerCase()
      const saved = team.playerNames.length
        ? legacyProfile?.players.find((player) => !usedPlayerIds.has(player.id) && player.id === `${team.id}-player-${index + 1}` && matchesName(player))
          ?? legacyProfile?.players.find((player) => !usedPlayerIds.has(player.id) && matchesName(player))
        : legacyProfile?.players[index]
      if (saved) usedPlayerIds.add(saved.id)
      const defaultId = `${team.id}-player-${index + 1}`
      const id = saved?.id ?? (legacyProfile?.players.some((player) => player.id === defaultId) ? crypto.randomUUID() : defaultId)
      usedPlayerIds.add(id)
      return {
        id,
        name: saved?.name || name,
        jerseyNumber: saved?.jerseyNumber ?? '',
        ...(team.playerNames.length ? { catalogName: name } : {}),
        isParticipating: saved?.isParticipating ?? !!name.trim(),
        isOnCourt: saved?.isOnCourt ?? false,
      }
    })
  if (legacyProfile) {
    players.push(...legacyProfile.players
      .filter((player) => !usedPlayerIds.has(player.id))
      .map((player) => ({ ...player })))
  }
  const rosterCoachNames = new Set(team.staff.map((member) => member.name.toLocaleLowerCase()))
  const coaches = team.staff.map((member, index): TeamProfileCoach => {
    const saved = legacyProfile?.coaches.find((coach) => coach.name.toLocaleLowerCase() === member.name.toLocaleLowerCase())
    return {
      id: saved?.id ?? `${team.id}-coach-${index + 1}`,
      name: member.name,
      role: member.role,
      isParticipating: saved?.isParticipating ?? false,
    }
  })
  if (legacyProfile) {
    coaches.push(...legacyProfile.coaches
      .filter((coach) => !rosterCoachNames.has(coach.name.toLocaleLowerCase()))
      .map((coach) => ({ ...coach })))
  }
  profile = {
    id: legacyProfile?.id ?? `zoebas-${team.id}`,
    name: team.name,
    catalogTeamId: team.id,
    players,
    coaches,
  }
  const profileIndex = draftProfiles.value.findIndex((item) => item.id === profile?.id)
  if (profileIndex >= 0) draftProfiles.value.splice(profileIndex, 1, profile)
  else draftProfiles.value.push(profile)
  selected.value[0] = profile.id
  catalogPlayerIds.value = players.slice(0, team.playerNames.length).map((player) => player.id)
}

function applySharedJerseyNumbers(team: ZoebasTeam, numbers: JerseyNumber[], clearMissing: boolean) {
  for (const [index, playerId] of catalogPlayerIds.value.entries()) {
    const shared = numbers.find((item) => item.position === index + 1 && item.name === team.playerNames[index])
    const player = currentProfile.value?.players.find((item) => item.id === playerId)
    if (player && (shared || clearMissing)) player.jerseyNumber = shared?.number ?? ''
  }
}

async function refreshJerseyNumbers(team: ZoebasTeam, replaceLocal: boolean) {
  const request = ++jerseyRequest
  jerseyLoading.value = true
  jerseyError.value = ''
  try {
    const numbers = await loadJerseyNumbers(team.id)
    if (request !== jerseyRequest) return
    jerseyNumbers.value = numbers
    if (replaceLocal) {
      applySharedJerseyNumbers(team, numbers, true)
    } else {
      const local = catalogPlayerIds.value.map((id) => currentProfile.value?.players.find((player) => player.id === id)?.jerseyNumber ?? '')
      const reconciled = reconcileJerseyNumbers(team.playerNames, local, numbers, jerseyBaselines.value[team.id], !!restoredDraft || initializedTeams.has(team.id))
      if (reconciled.conflict) {
        jerseyError.value = t('teamSetup.jerseySaveError')
        return
      }
      for (const [index, playerId] of catalogPlayerIds.value.entries()) {
        const player = currentProfile.value?.players.find((item) => item.id === playerId)
        if (player) player.jerseyNumber = reconciled.numbers[index] ?? ''
      }
    }
    jerseyBaselines.value[team.id] = numbers
    initializedTeams.add(team.id)
  } catch (error) {
    console.error('Failed to load shared jersey numbers.', error)
    if (request === jerseyRequest) jerseyError.value = t('teamSetup.jerseyLoadError')
  } finally {
    if (request === jerseyRequest) jerseyLoading.value = false
  }
}

function retryJerseyNumbers() {
  const team = props.catalogTeams.find((item) => item.id === selectedCatalogTeamId.value)
  if (team) void refreshJerseyNumbers(team, true)
}

function selectMatch(match: ZoebasMatch) {
  if (match.status === 'Cancelled') return
  selectedMatchId.value = match.id
  manualOpponentName.value = ''
}

function selectManualMatch() {
  selectedMatchId.value = ''
}

function formatMatchDate(match: ZoebasMatch) {
  const date = new Date(`${match.date}T${match.startTime}:00`)
  return `${date.toLocaleDateString()} · ${match.startTime}`
}

let matchRequest = 0
let jerseyRequest = 0
watch([selectedCatalogTeamId, () => props.catalogTeams], async ([teamId], previous) => {
  if (props.rosterProfile) return
  const request = ++matchRequest
  ++jerseyRequest
  matches.value = []
  if (!previous || teamId !== previous[0]) {
    selectedMatchId.value = ''
    manualOpponentName.value = ''
  }
  matchError.value = ''
  matchLoading.value = false
  jerseyError.value = ''
  jerseyNumbers.value = []
  jerseyLoading.value = false
  if (!props.catalogTeams.length) return
  if (!teamId) return

  const team = props.catalogTeams.find((item) => item.id === teamId)
  if (!team) return
  selectCatalogTeam(teamId)
  void refreshJerseyNumbers(team, false)
  matchLoading.value = true
  try {
    const fetchedMatches = await loadZoebasMatches(team.sourceTeamId)
    if (request !== matchRequest) return
    matches.value = fetchedMatches
  } catch (error) {
    console.error('Failed to load the Zoebas match schedule.', error)
    if (request === matchRequest) matchError.value = t('errors.loadMatchSchedule')
  } finally {
    if (request === matchRequest) matchLoading.value = false
  }
}, { immediate: true })

function addPlayer() {
  if (!currentProfile.value) return
  currentProfile.value.players.push({
    id: crypto.randomUUID(),
    name: '',
    jerseyNumber: '',
    isParticipating: true,
    isOnCourt: false,
  })
}

function addCoach() {
  if (!currentProfile.value) return
  const name = newCoachName.value.trim()
  if (!name) return
  currentProfile.value.coaches.push({
    id: crypto.randomUUID(),
    name,
    role: newCoachRole.value,
    isParticipating: true,
  })
  newCoachName.value = ''
}

function toggleCoachParticipation(coach: TeamProfileCoach) {
  coach.isParticipating = !coach.isParticipating
}

function toggleParticipation(player: TeamProfilePlayer) {
  player.isParticipating = !player.isParticipating
  if (!player.isParticipating && !props.rosterProfile) player.isOnCourt = false
}

function participantError(profile: TeamProfile | undefined) {
  if (!profile?.name.trim()) return t('teamSetup.teamNameRequired')
  const participants = profile.players.filter((player) => player.isParticipating)
  if (participants.length < 2) return t('teamSetup.selectAtLeastFive')
  if (participants.some((player) => !player.name.trim() || !/^\d{1,2}$/.test(player.jerseyNumber))) {
    return t('teamSetup.participantDetailsRequired')
  }
  if (new Set(participants.map((player) => Number(player.jerseyNumber))).size !== participants.length) {
    return t('teamSetup.duplicateNumbers')
  }
  return ''
}

const currentStepError = computed(() => {
  if (step.value !== 1) return ''
  const error = participantError(currentProfile.value ?? undefined)
  if (error) return error
  if (props.requireOnCourt && participatingPlayers.value.filter((player) => player.isOnCourt).length < 2) {
    return t('teamSetup.rosterMinOnCourt')
  }
  return ''
})
const validTeam = computed(() => !props.catalogError && !jerseyLoading.value && !jerseyError.value && !!availableTeams.value.find((team) => team.id === selectedCatalogTeamId.value))
const canAdvance = computed(() => {
  if (props.rosterProfile) return !currentStepError.value
  if (step.value === 0) return validTeam.value
  if (step.value === 1) return validTeam.value && !currentStepError.value
  return hasMatchSelection.value
})

function catalogRoster(team: ZoebasTeam, profile: TeamProfile) {
  const used = new Set<string>()
  return team.playerNames.flatMap((name, index) => {
    const player = profile.players.find((item) => !used.has(item.id) && item.catalogName === name)
    if (!player) return []
    used.add(player.id)
    return [{ name, position: index + 1, player }]
  })
}

async function reloadRosterJerseys() {
  const profile = currentProfile.value
  const team = props.catalogTeams.find((item) => item.id === profile?.catalogTeamId)
  if (!profile || !team) {
    jerseyError.value = t('teamSetup.jerseyLoadError')
    return
  }
  jerseyLoading.value = true
  try {
    const numbers = await loadJerseyNumbers(team.id)
    for (const { name, position, player } of catalogRoster(team, profile)) {
      player.jerseyNumber = numbers.find((item) => item.position === position && item.name === name)?.number ?? ''
      rosterJerseyBaseline.set(player.id, player.jerseyNumber)
    }
    jerseyError.value = ''
  } catch (error) {
    console.error('Failed to load shared jersey numbers.', error)
    jerseyError.value = t('teamSetup.jerseyLoadError')
  } finally {
    jerseyLoading.value = false
  }
}

async function saveRoster() {
  const profile = currentProfile.value
  if (!profile || !canAdvance.value) return
  const changedCatalogPlayers = profile.players.filter((player) =>
    player.catalogName && rosterJerseyBaseline.has(player.id) && player.jerseyNumber !== rosterJerseyBaseline.get(player.id),
  )
  if (changedCatalogPlayers.length) {
    const team = props.catalogTeams.find((item) => item.id === profile.catalogTeamId)
    if (!team) {
      jerseyError.value = t('teamSetup.jerseyLoadError')
      return
    }
    const changes: JerseyChange[] = catalogRoster(team, profile).flatMap(({ name, position, player }) => {
      if (!changedCatalogPlayers.includes(player)) return []
      return [{
        position,
        name,
        expected: rosterJerseyBaseline.get(player.id) || null,
        number: player.jerseyNumber || null,
      }]
    })
    if (changes.length !== changedCatalogPlayers.length) {
      jerseyError.value = t('teamSetup.jerseyLoadError')
      return
    }
    jerseySaving.value = true
    jerseyError.value = ''
    try {
      await saveJerseyNumbers(team.id, changes)
      for (const player of changedCatalogPlayers) rosterJerseyBaseline.set(player.id, player.jerseyNumber)
    } catch (error) {
      console.error('Failed to save shared jersey numbers.', error)
      jerseyError.value = t('teamSetup.jerseySaveError')
      return
    } finally {
      jerseySaving.value = false
    }
  }
  emit('save-roster', profile)
}

function save() {
  if (!canAdvance.value || participantError(currentProfile.value ?? undefined)) return
  const opponentId = 'watchtower-placeholder-opponent'
  const opponent: TeamProfile = {
    id: opponentId,
    name: manualOpponentName.value.trim() || t('teamSetup.away'),
    players: Array.from({ length: 5 }, (_, index) => ({
      id: `player-${index + 1}`,
      name: `player_${index + 1}`,
      jerseyNumber: String(index + 1),
      isParticipating: true,
      isOnCourt: true,
    })),
    coaches: [],
  }
  emit('save', [...draftProfiles.value.filter((profile) => profile.id !== opponentId), opponent], [selected.value[0], opponentId], selectedMatch.value, manualOpponentName.value.trim())
}

function advance() {
  if (!canAdvance.value) return
  if (step.value === steps.length - 1) save()
  else void navigateTo(step.value + 1)
}

function canNavigateTo(index: number) {
  return !jerseySaving.value && (index <= step.value || (index === step.value + 1 && canAdvance.value))
}

async function navigateTo(index: number) {
  if (!canNavigateTo(index)) return
  const movingForward = index > step.value
  if (step.value === 1 && index === 2) {
    const team = props.catalogTeams.find((item) => item.id === selectedCatalogTeamId.value)
    if (!team || !currentProfile.value) return
    const changes: JerseyChange[] = catalogPlayerIds.value.flatMap((id, index) => {
      const player = currentProfile.value?.players.find((item) => item.id === id)
      const name = team.playerNames[index]
      if (!player || !name) return []
      const expected = jerseyNumbers.value.find((item) => item.position === index + 1 && item.name === name)?.number ?? null
      const number = player.jerseyNumber || null
      return number === expected ? [] : [{ position: index + 1, name, expected, number }]
    })
    jerseySaving.value = true
    jerseyError.value = ''
    try {
      await saveJerseyNumbers(team.id, changes)
      for (const change of changes) {
        jerseyNumbers.value = jerseyNumbers.value.filter((item) => item.position !== change.position)
        if (change.number !== null) jerseyNumbers.value.push({ position: change.position, name: change.name, number: change.number })
      }
      jerseyBaselines.value[team.id] = jerseyNumbers.value
    } catch (error) {
      console.error('Failed to save shared jersey numbers.', error)
      jerseyError.value = t('teamSetup.jerseySaveError')
      return
    } finally {
      jerseySaving.value = false
    }
  }
  step.value = index
  furthestStep.value = Math.max(furthestStep.value, index)
  if (movingForward) {
    await nextTick()
    if (stepContent.value) stepContent.value.scrollTop = 0
    if (props.home) window.scrollTo(0, 0)
  }
}

function stepCompleted(index: number) {
  if (index >= furthestStep.value) return false
  if (index === 0) return validTeam.value
  return validTeam.value && !participantError(currentProfile.value ?? undefined)
}
</script>

<template>
  <div
    :class="home ? 'team-setup-page' : 'team-setup-backdrop'"
    @keydown.esc.window="canCancel && !jerseySaving && emit('cancel')"
  >
    <section
      class="team-setup-dialog panel"
      :class="{ 'team-setup-home-card': home }"
      :role="home ? 'region' : 'dialog'"
      :aria-modal="home ? undefined : true"
      :aria-label="t(rosterProfile ? 'scoreboard.editPlayers' : 'teamSetup.title')"
    >
      <header v-if="canCancel" class="team-setup-header">
        <button class="team-setup-close" type="button" :disabled="jerseySaving" :aria-label="t('teamSetup.cancel')" @click="emit('cancel')">×</button>
      </header>
      <p v-if="error || (!rosterProfile && catalogError) || draftStorageError" class="notice team-setup-notice" role="alert">{{ error || catalogError || t(draftStorageError) }}</p>
      <div v-if="jerseyError" class="notice team-setup-notice" role="alert">
        <p>{{ jerseyError }}</p>
        <button type="button" :disabled="jerseyLoading || jerseySaving" @click="rosterProfile ? reloadRosterJerseys() : retryJerseyNumbers()">{{ t('teamSetup.reloadJerseys') }}</button>
      </div>

      <h2 v-if="rosterProfile">{{ t('scoreboard.editPlayers') }}</h2>
      <div v-else class="team-setup-steps" role="tablist" :aria-label="t('teamSetup.title')">
        <button
          v-for="(wizardStep, index) in steps"
          :key="wizardStep"
          type="button"
          :disabled="!canNavigateTo(index)"
          role="tab"
          :aria-selected="step === index"
          :aria-current="step === index ? 'step' : undefined"
          :class="{ selected: step === index, completed: stepCompleted(index) && step !== index }"
          @click="navigateTo(index)"
        ><span class="team-setup-step-number" aria-hidden="true">{{ stepCompleted(index) && step !== index ? '✓' : index + 1 }}</span><span class="team-setup-step-label">{{ index === 0 && validTeam ? currentProfile?.name : t(`teamSetup.${wizardStep}`) }}</span></button>
      </div>

      <div ref="stepContent" class="team-setup-team">
        <template v-if="step === 0">
          <h3>{{ t('teamSetup.chooseClubTeam') }}</h3>
          <p v-if="catalogLoading" class="team-setup-hint" role="status">{{ t('teamSetup.loadingClubTeams') }}</p>
          <p v-else-if="!catalogError && !availableTeams.length" class="team-setup-hint" role="status">{{ t('teamSetup.noTeamsWithPlayers') }}</p>
          <div class="team-setup-team-grid" role="group" :aria-label="t('teamSetup.chooseClubTeam')">
            <button v-for="team in availableTeams" :key="team.id" type="button"
              :aria-pressed="selectedCatalogTeamId === team.id" :disabled="jerseySaving"
              @click="selectedCatalogTeamId = team.id">{{ team.name }}</button>
          </div>
        </template>
        <section v-if="step === 2" class="team-setup-matches" aria-labelledby="team-match-heading">
          <h3 id="team-match-heading">{{ t('teamSetup.chooseMatch') }}</h3>
          <label class="team-setup-field">
            <span>{{ t('teamSetup.manualOpponent') }}</span>
            <input v-model="manualOpponentName" type="text" maxlength="60" :placeholder="t('teamSetup.manualOpponent')" @input="selectManualMatch">
          </label>
          <p v-if="matchLoading" class="team-setup-hint" role="status">{{ t('teamSetup.loadingMatches') }}</p>
          <p v-if="matchError" class="team-setup-error" role="alert">{{ matchError }}</p>
          <template v-else-if="!matchLoading && matches.length">
            <h4>{{ t('teamSetup.program') }}</h4>
            <p v-if="!upcomingMatches.length" class="team-setup-hint">{{ t('teamSetup.noUpcomingMatches') }}</p>
            <button
              v-for="match in upcomingMatches"
              :key="match.id"
              class="team-setup-match-option"
              :class="{ selected: selectedMatchId === match.id }"
              type="button"
              :disabled="match.status === 'Cancelled'"
              :aria-pressed="selectedMatchId === match.id"
              @click="selectMatch(match)"
            >
              <span class="team-setup-match-date">{{ formatMatchDate(match) }}</span>
              <strong>{{ match.homeTeamName }} – {{ match.awayTeamName }}</strong>
              <span v-if="match.venue">{{ t('teamSetup.venue', { venue: match.venue }) }}</span>
              <span v-if="match.id === recommendedMatch?.id" class="team-setup-match-badge">{{ t('teamSetup.recommendedMatch') }}</span>
              <span v-if="match.status === 'Cancelled'" class="team-setup-match-badge">{{ t('teamSetup.cancelledMatch') }}</span>
            </button>
            <h4>{{ t('teamSetup.results') }}</h4>
            <p v-if="!pastMatches.length" class="team-setup-hint">{{ t('teamSetup.noPastMatches') }}</p>
            <button
              v-for="match in pastMatches"
              :key="match.id"
              class="team-setup-match-option"
              :class="{ selected: selectedMatchId === match.id }"
              type="button"
              :disabled="match.status === 'Cancelled'"
              :aria-pressed="selectedMatchId === match.id"
              @click="selectMatch(match)"
            >
              <span class="team-setup-match-date">{{ formatMatchDate(match) }}</span>
              <strong>{{ match.homeTeamName }} {{ match.homeScore ?? '–' }} – {{ match.awayScore ?? '–' }} {{ match.awayTeamName }}</strong>
              <span v-if="match.venue">{{ t('teamSetup.venue', { venue: match.venue }) }}</span>
              <span v-if="match.id === recommendedMatch?.id" class="team-setup-match-badge">{{ t('teamSetup.recommendedMatch') }}</span>
              <span v-if="match.status === 'Cancelled'" class="team-setup-match-badge">{{ t('teamSetup.cancelledMatch') }}</span>
            </button>
          </template>
          <p v-else-if="!matchLoading && !matchError" class="team-setup-hint">{{ t('teamSetup.noMatches') }}</p>
          <p v-if="!hasMatchSelection" class="team-setup-error">{{ t('teamSetup.chooseMatchRequired') }}</p>
        </section>

        <template v-if="step === 1 && currentProfile">
        <div class="team-setup-roster-heading">
          <h3>{{ t('teamSetup.players') }}</h3>
          <span>{{ t('teamSetup.participantCount', { count: participatingMembersCount }) }}</span>
        </div>
        <p class="team-setup-hint">{{ t('teamSetup.participantHint') }}</p>
        <p v-if="!rosterProfile || currentProfile.catalogTeamId" class="team-setup-hint">{{ t('teamSetup.sharedJerseysHint') }}</p>
        <div class="team-setup-player team-setup-column-heading" aria-hidden="true">
          <span>#</span><span>{{ t('teamSetup.name') }}</span><span>{{ t('teamSetup.present') }}</span>
        </div>
        <div class="team-setup-roster">
          <div v-for="player in currentProfile.players" :key="player.id" class="team-setup-player">
            <input v-model="player.jerseyNumber" class="team-setup-jersey-input" type="text" inputmode="numeric" maxlength="2" :disabled="jerseySaving" :aria-label="t('teamSetup.jerseyNumber')" placeholder="#" @input="player.jerseyNumber = player.jerseyNumber.replace(/\D/g, '').slice(0, 2)">
            <input v-model="player.name" type="text" :disabled="jerseySaving" :aria-label="t('teamSetup.playerName')" :placeholder="t('teamSetup.playerName')" maxlength="60">
            <button
              class="team-setup-court-toggle"
              type="button"
              :disabled="jerseySaving"
              :aria-pressed="player.isParticipating"
              :aria-label="t('teamSetup.participation', { name: player.name || t('teamSetup.playerName') })"
              :title="t(player.isParticipating ? 'teamSetup.present' : 'teamSetup.absent')"
              @click="toggleParticipation(player)"
            ><span aria-hidden="true">{{ t('teamSetup.no') }}</span><span aria-hidden="true">{{ t('teamSetup.yes') }}</span></button>
          </div>
        </div>
        <button class="team-setup-add-player" type="button" :disabled="jerseySaving" @click="addPlayer">+ {{ t('teamSetup.addPlayer') }}</button>
        <section class="team-setup-coaches" :aria-label="t('teamSetup.coaches')">
          <div class="team-setup-roster-heading">
            <h3>{{ t('teamSetup.coaches') }}</h3>
            <span>{{ t('teamSetup.coachesSelected', { count: currentProfile?.coaches.filter((coach) => coach.isParticipating).length ?? 0 }) }}</span>
          </div>
          <div v-if="currentProfile.coaches.length" class="team-setup-player team-setup-column-heading" aria-hidden="true">
            <span class="team-setup-coach-name">{{ t('teamSetup.name') }}</span><span>{{ t('teamSetup.present') }}</span>
          </div>
          <div class="team-setup-roster">
            <div v-for="coach in currentProfile?.coaches ?? []" :key="coach.id" class="team-setup-player team-setup-coach">
              <span class="team-setup-coach-name">{{ coach.name }} <small>{{ t(coach.role === 'assistant' ? 'teamSetup.assistantCoach' : 'teamSetup.coach') }}</small></span>
              <button
                class="team-setup-court-toggle"
                type="button"
                :disabled="jerseySaving"
                :aria-pressed="coach.isParticipating"
                :aria-label="t('teamSetup.participation', { name: coach.name })"
                :title="t(coach.isParticipating ? 'teamSetup.present' : 'teamSetup.absent')"
                @click="toggleCoachParticipation(coach)"
              ><span aria-hidden="true">{{ t('teamSetup.no') }}</span><span aria-hidden="true">{{ t('teamSetup.yes') }}</span></button>
            </div>
          </div>
          <form class="team-setup-add-coach" @submit.prevent="addCoach">
            <input v-model="newCoachName" type="text" :disabled="jerseySaving" :aria-label="t('teamSetup.coachName')" :placeholder="t('teamSetup.coachName')" maxlength="60">
            <select v-model="newCoachRole" :disabled="jerseySaving" :aria-label="t('teamSetup.coachRole')">
              <option value="coach">{{ t('teamSetup.coach') }}</option>
              <option value="assistant">{{ t('teamSetup.assistantCoach') }}</option>
            </select>
            <button class="team-setup-add-player" type="submit" :disabled="jerseySaving || !newCoachName.trim()">+ {{ t('teamSetup.addCoachButton') }}</button>
          </form>
        </section>
        <p v-if="currentStepError" class="team-setup-error" role="alert">{{ currentStepError }}</p>
        </template>
      </div>

      <footer class="team-setup-footer">
        <button v-if="rosterProfile" class="team-setup-secondary" type="button" :disabled="jerseySaving" @click="emit('cancel')">{{ t('teamSetup.cancel') }}</button>
        <button v-else-if="step > 0" class="team-setup-secondary" type="button" :disabled="jerseySaving" @click="step--">{{ t('teamSetup.back') }}</button>
        <button v-if="rosterProfile" class="team-setup-primary" type="button" :disabled="!canAdvance || jerseySaving || jerseyLoading" @click="saveRoster">{{ t('teamSetup.saveAndContinue') }}</button>
        <button v-else class="team-setup-primary" type="button" :disabled="!canAdvance || jerseySaving" @click="advance">{{ t(step === steps.length - 1 ? 'teamSetup.saveAndContinue' : 'teamSetup.next') }}</button>
      </footer>
    </section>
  </div>
</template>
