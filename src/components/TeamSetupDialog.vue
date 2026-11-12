<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useLocale } from '../i18n/useLocale'
import { loadTeamSetupDraft, saveTeamSetupDraft, type TeamProfile, type TeamProfileCoach, type TeamProfilePlayer, type TeamSetupDraft } from '../services/teamProfiles'
import { getRecommendedMatch, loadZoebasMatches, type ZoebasMatch } from '../services/zoebasMatches'
import type { ZoebasTeam } from '../services/zoebasTeams'
import { useSharedJerseyNumbers } from '../composables/useSharedJerseyNumbers'
import RosterEditor from './RosterEditor.vue'
import BaseDialog from './BaseDialog.vue'

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
const catalogPlayerIds = ref<string[]>([])
const availableTeams = computed(() => props.catalogTeams.filter((team) => team.playerNames.length > 0))
const currentProfile = computed(() =>
  draftProfiles.value.find((profile) => profile.id === selected.value[0]) ?? null,
)
const {
  loading: jerseyLoading,
  saving: jerseySaving,
  error: jerseyError,
  baselines: jerseyBaselines,
  reset: resetJerseys,
  load: loadJerseys,
  reload: reloadJerseys,
  save: saveJerseys,
} = useSharedJerseyNumbers({
  rosterProfile: props.rosterProfile,
  getProfile: () => currentProfile.value,
  getTeam: () => props.catalogTeams.find((team) =>
    team.id === (props.rosterProfile ? currentProfile.value?.catalogTeamId : selectedCatalogTeamId.value),
  ),
  catalogPlayerIds,
  initialBaselines: restoredDraft?.jerseyBaselines,
  restoredDraft: !!restoredDraft,
})
const participatingPlayers = computed(() => currentProfile.value?.players.filter((player) => player.isParticipating) ?? [])
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
  if (props.rosterProfile) return
  const request = ++matchRequest
  resetJerseys()
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
  void loadJerseys(team, false)
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

async function saveRoster() {
  const profile = currentProfile.value
  if (!profile || !canAdvance.value) return
  if (!await saveJerseys()) return
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
    if (!await saveJerseys()) return
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
  <BaseDialog
    :backdrop-class="home ? 'team-setup-page' : 'team-setup-backdrop'"
    :dialog-class="`team-setup-dialog panel${home ? ' team-setup-home-card' : ''}`"
    :modal="!home"
    :close-on-escape="canCancel && !jerseySaving"
    :label="t(rosterProfile ? 'scoreboard.editPlayers' : 'teamSetup.title')"
    @close="emit('cancel')"
  >
      <header v-if="canCancel" class="team-setup-header">
        <button class="team-setup-close" type="button" :disabled="jerseySaving" :aria-label="t('teamSetup.cancel')" @click="emit('cancel')">×</button>
      </header>
      <p v-if="error || (!rosterProfile && catalogError) || draftStorageError" class="notice team-setup-notice" role="alert">{{ error || catalogError || t(draftStorageError) }}</p>
      <div v-if="jerseyError" class="notice team-setup-notice" role="alert">
        <p>{{ jerseyError }}</p>
        <button type="button" :disabled="jerseyLoading || jerseySaving" @click="reloadJerseys">{{ t('teamSetup.reloadJerseys') }}</button>
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

        <div v-if="currentProfile" v-show="step === 1">
          <RosterEditor
            :profile="currentProfile"
            :disabled="jerseySaving || jerseyLoading"
            :clear-court-on-absence="!rosterProfile"
            :show-shared-jerseys-hint="!rosterProfile || !!currentProfile.catalogTeamId"
            :error="currentStepError"
          />
        </div>
      </div>

      <footer class="team-setup-footer">
        <button v-if="rosterProfile" class="team-setup-secondary" type="button" :disabled="jerseySaving" @click="emit('cancel')">{{ t('teamSetup.cancel') }}</button>
        <button v-else-if="step > 0" class="team-setup-secondary" type="button" :disabled="jerseySaving" @click="step--">{{ t('teamSetup.back') }}</button>
        <button v-if="rosterProfile" class="team-setup-primary" type="button" :disabled="!canAdvance || jerseySaving || jerseyLoading" @click="saveRoster">{{ t('teamSetup.saveAndContinue') }}</button>
        <button v-else class="team-setup-primary" type="button" :disabled="!canAdvance || jerseySaving" @click="advance">{{ t(step === steps.length - 1 ? 'teamSetup.saveAndContinue' : 'teamSetup.next') }}</button>
      </footer>
  </BaseDialog>
</template>
