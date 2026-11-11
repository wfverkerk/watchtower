<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLocale } from '../i18n/useLocale'
import { loadTeamSetupDraft, saveTeamSetupDraft, type TeamProfile, type TeamProfileCoach, type TeamProfilePlayer, type TeamSetupDraft } from '../services/teamProfiles'
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
}>()

const emit = defineEmits<{
  cancel: []
  save: [profiles: TeamProfile[], selectedProfileIds: [string, string], match: ZoebasMatch | null, manualOpponentName: string]
}>()

const { t } = useLocale()
const steps = ['stepTeam', 'stepPlayers', 'stepOpponent'] as const
const step = ref(0)
const furthestStep = ref(0)
const draftStorageError = ref('')
let draftLoadFailed = false
let restoredDraft: TeamSetupDraft | null = null
try {
  restoredDraft = loadTeamSetupDraft()
} catch (error) {
  console.error('Failed to load team setup draft.', error)
  draftStorageError.value = 'errors.loadTeams'
  draftLoadFailed = true
}
const draftProfiles = ref((restoredDraft?.profiles ?? props.profiles).map((profile) => ({
  ...profile,
  players: profile.players.map((player) => ({ ...player, isParticipating: player.isParticipating ?? true })),
  coaches: (profile.coaches ?? []).map((coach) => ({ ...coach, isParticipating: coach.isParticipating ?? true })),
})))
const selected = ref<[string, string]>([...(restoredDraft?.selectedProfileIds ?? props.selectedProfileIds)])
const selectedCatalogTeamId = ref(
  restoredDraft?.catalogTeamId || (draftProfiles.value.find((profile) => profile.id === selected.value[0])?.catalogTeamId ?? ''),
)
const matches = ref<ZoebasMatch[]>([])
const matchLoading = ref(false)
const matchError = ref('')
const selectedMatchId = ref('')
const manualOpponentName = ref('')
const newCoachName = ref('')
const newCoachRole = ref<TeamProfileCoach['role']>('coach')
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

watch([draftProfiles, selected, selectedCatalogTeamId], () => {
  if (!selectedCatalogTeamId.value || draftLoadFailed) return
  try {
    saveTeamSetupDraft({
      profiles: draftProfiles.value,
      selectedProfileIds: selected.value,
      catalogTeamId: selectedCatalogTeamId.value,
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
  const players = (team.playerNames.length ? team.playerNames : Array.from({ length: 5 }, () => '')).map((name, index): TeamProfilePlayer => {
      const saved = legacyProfile?.players.find((player) => !usedPlayerIds.has(player.id) && player.id === `${team.id}-player-${index + 1}`)
        ?? legacyProfile?.players.find((player) => !usedPlayerIds.has(player.id) && player.name.toLocaleLowerCase() === name.toLocaleLowerCase())
        ?? legacyProfile?.players.find((player, savedIndex) => savedIndex === index && !usedPlayerIds.has(player.id))
      if (saved) usedPlayerIds.add(saved.id)
      return {
        id: saved?.id ?? `${team.id}-player-${index + 1}`,
        name: saved?.name || name,
        jerseyNumber: saved?.jerseyNumber ?? '',
        isParticipating: saved?.isParticipating ?? false,
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
watch([selectedCatalogTeamId, () => props.catalogTeams], async ([teamId], previous) => {
  const request = ++matchRequest
  matches.value = []
  if (!previous || teamId !== previous[0]) {
    selectedMatchId.value = ''
    manualOpponentName.value = ''
  }
  matchError.value = ''
  matchLoading.value = false
  if (!props.catalogTeams.length) return
  if (!teamId) return

  const team = props.catalogTeams.find((item) => item.id === teamId)
  if (!team) return
  selectCatalogTeam(teamId)
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
    isParticipating: false,
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
  if (!player.isParticipating) player.isOnCourt = false
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

const currentStepError = computed(() => step.value === 1 ? participantError(currentProfile.value ?? undefined) : '')
const validTeam = computed(() => !props.catalogError && !!props.catalogTeams.find((team) => team.id === selectedCatalogTeamId.value))
const canAdvance = computed(() => {
  if (step.value === 0) return validTeam.value
  if (step.value === 1) return !currentStepError.value
  return hasMatchSelection.value
})

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
  else navigateTo(step.value + 1)
}

function canNavigateTo(index: number) {
  return index <= step.value || (index === step.value + 1 && canAdvance.value)
}

function navigateTo(index: number) {
  if (!canNavigateTo(index)) return
  step.value = index
  furthestStep.value = Math.max(furthestStep.value, index)
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
    @keydown.esc.window="canCancel && emit('cancel')"
  >
    <section
      class="team-setup-dialog panel"
      :class="{ 'team-setup-home-card': home }"
      :role="home ? 'region' : 'dialog'"
      :aria-modal="home ? undefined : true"
      :aria-label="t('teamSetup.title')"
    >
      <header v-if="canCancel" class="team-setup-header">
        <button class="team-setup-close" type="button" :aria-label="t('teamSetup.cancel')" @click="emit('cancel')">×</button>
      </header>
      <p v-if="error || catalogError || draftStorageError" class="notice team-setup-notice" role="alert">{{ error || catalogError || t(draftStorageError) }}</p>

      <div class="team-setup-steps" role="tablist" :aria-label="t('teamSetup.title')">
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

      <div class="team-setup-team">
        <template v-if="step === 0">
          <h3>{{ t('teamSetup.chooseClubTeam') }}</h3>
          <p v-if="catalogLoading" class="team-setup-hint" role="status">{{ t('teamSetup.loadingClubTeams') }}</p>
          <div class="team-setup-team-grid" role="group" :aria-label="t('teamSetup.chooseClubTeam')">
            <button v-for="team in catalogTeams" :key="team.id" type="button"
              :aria-pressed="selectedCatalogTeamId === team.id"
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
        <div class="team-setup-player team-setup-column-heading" aria-hidden="true">
          <span>#</span><span>{{ t('teamSetup.name') }}</span><span>{{ t('teamSetup.present') }}</span>
        </div>
        <div class="team-setup-roster">
          <div v-for="player in currentProfile.players" :key="player.id" class="team-setup-player">
            <input v-model="player.jerseyNumber" class="team-setup-jersey-input" type="text" inputmode="numeric" maxlength="2" :aria-label="t('teamSetup.jerseyNumber')" placeholder="#" @input="player.jerseyNumber = player.jerseyNumber.replace(/\D/g, '').slice(0, 2)">
            <input v-model="player.name" type="text" :aria-label="t('teamSetup.playerName')" :placeholder="t('teamSetup.playerName')" maxlength="60">
            <button
              class="team-setup-court-toggle"
              type="button"
              :aria-pressed="player.isParticipating"
              :aria-label="t('teamSetup.participation', { name: player.name || t('teamSetup.playerName') })"
              :title="t(player.isParticipating ? 'teamSetup.present' : 'teamSetup.absent')"
              @click="toggleParticipation(player)"
            ><span aria-hidden="true">{{ t('teamSetup.no') }}</span><span aria-hidden="true">{{ t('teamSetup.yes') }}</span></button>
          </div>
        </div>
        <button class="team-setup-add-player" type="button" @click="addPlayer">+ {{ t('teamSetup.addPlayer') }}</button>
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
                :aria-pressed="coach.isParticipating"
                :aria-label="t('teamSetup.participation', { name: coach.name })"
                :title="t(coach.isParticipating ? 'teamSetup.present' : 'teamSetup.absent')"
                @click="toggleCoachParticipation(coach)"
              ><span aria-hidden="true">{{ t('teamSetup.no') }}</span><span aria-hidden="true">{{ t('teamSetup.yes') }}</span></button>
            </div>
          </div>
          <form class="team-setup-add-coach" @submit.prevent="addCoach">
            <input v-model="newCoachName" type="text" :aria-label="t('teamSetup.coachName')" :placeholder="t('teamSetup.coachName')" maxlength="60">
            <select v-model="newCoachRole" :aria-label="t('teamSetup.coachRole')">
              <option value="coach">{{ t('teamSetup.coach') }}</option>
              <option value="assistant">{{ t('teamSetup.assistantCoach') }}</option>
            </select>
            <button class="team-setup-add-player" type="submit" :disabled="!newCoachName.trim()">+ {{ t('teamSetup.addCoachButton') }}</button>
          </form>
        </section>
        <p v-if="currentStepError" class="team-setup-error" role="alert">{{ currentStepError }}</p>
        </template>
      </div>

      <footer class="team-setup-footer">
        <button v-if="step > 0" class="team-setup-secondary" type="button" @click="step--">{{ t('teamSetup.back') }}</button>
        <button class="team-setup-primary" type="button" :disabled="!canAdvance" @click="advance">{{ t(step === steps.length - 1 ? 'teamSetup.saveAndContinue' : 'teamSetup.next') }}</button>
      </footer>
    </section>
  </div>
</template>
