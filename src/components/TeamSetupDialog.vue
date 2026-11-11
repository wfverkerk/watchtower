<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLocale } from '../i18n/useLocale'
import type { TeamProfile, TeamProfileCoach, TeamProfilePlayer } from '../services/teamProfiles'
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
const sides = ['home', 'away'] as const
const steps = [
  { side: 0, stage: 'participants' },
  { side: 1, stage: 'participants' },
  { side: 0, stage: 'starters' },
  { side: 1, stage: 'starters' },
] as const
const step = ref(0)
const draftProfiles = ref(props.profiles.map((profile) => ({
  ...profile,
  players: profile.players.map((player) => ({ ...player, isParticipating: player.isParticipating ?? true })),
  coaches: (profile.coaches ?? []).map((coach) => ({ ...coach, isParticipating: coach.isParticipating ?? true })),
})))
const selected = ref<[string, string]>([...props.selectedProfileIds])
const selectedCatalogTeamId = ref(
  draftProfiles.value.find((profile) => profile.id === selected.value[0])?.catalogTeamId
    ?? props.catalogTeams[0]?.id
    ?? '',
)
const matches = ref<ZoebasMatch[]>([])
const matchLoading = ref(false)
const matchError = ref('')
const selectedMatchId = ref('')
const manualMatchSelected = ref(false)
const manualOpponentName = ref('')
const newCoachName = ref('')
const newCoachRole = ref<TeamProfileCoach['role']>('coach')
const currentStep = computed(() => steps[step.value])
const sideIndex = computed(() => currentStep.value.side)
const isSelectingParticipants = computed(() => currentStep.value.stage === 'participants')
const isSelectingHomeParticipants = computed(() => sideIndex.value === 0 && isSelectingParticipants.value)
const currentProfileId = computed(() => selected.value[sideIndex.value])
const currentProfile = computed(() =>
  draftProfiles.value.find((profile) => profile.id === currentProfileId.value) ?? null,
)
const participatingPlayers = computed(() => currentProfile.value?.players.filter((player) => player.isParticipating) ?? [])
const participatingMembersCount = computed(() =>
  participatingPlayers.value.length + (currentProfile.value?.coaches.filter((coach) => coach.isParticipating).length ?? 0),
)
const visiblePlayers = computed(() => {
  if (!currentProfile.value) return []
  return isSelectingParticipants.value ? currentProfile.value.players : participatingPlayers.value
})
const currentPlayersOnCourt = computed(() => currentProfile.value?.players.filter((player) => player.isOnCourt).length ?? 0)
const opponentProfiles = computed(() => draftProfiles.value.filter((profile) => !profile.catalogTeamId))
const selectionError = computed(() =>
  selected.value[0] && selected.value[0] === selected.value[1] ? t('teamSetup.distinctTeams') : '',
)
const selectedMatch = computed(() => matches.value.find((match) => match.id === selectedMatchId.value) ?? null)
const recommendedMatch = computed(() => getRecommendedMatch(matches.value))
const upcomingMatches = computed(() => matches.value.filter((match) =>
  new Date(`${match.date}T${match.startTime}:00`).getTime() >= Date.now(),
))
const pastMatches = computed(() => matches.value.filter((match) =>
  new Date(`${match.date}T${match.startTime}:00`).getTime() < Date.now(),
))
const hasMatchSelection = computed(() => !!selectedMatch.value || (manualMatchSelected.value && !!manualOpponentName.value.trim()))

function updateSelectedProfile(value: string) {
  selected.value[sideIndex.value] = value
}

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
  const rosterNames = new Set(team.playerNames.map((name) => name.toLocaleLowerCase()))
  const players = (team.playerNames.length ? team.playerNames : Array.from({ length: 5 }, () => '')).map((name, index): TeamProfilePlayer => {
      const saved = legacyProfile?.players.find((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())
        ?? legacyProfile?.players[index]
      return {
        id: `${team.id}-player-${index + 1}`,
        name,
        jerseyNumber: saved?.jerseyNumber ?? '',
        isParticipating: saved?.isParticipating ?? false,
        isOnCourt: saved?.isOnCourt ?? false,
      }
    })
  if (legacyProfile) {
    players.push(...legacyProfile.players
      .filter((player) => !rosterNames.has(player.name.toLocaleLowerCase()))
      .map((player) => ({ ...player })))
  }
  const rosterCoachNames = new Set(team.staff.map((member) => member.name.toLocaleLowerCase()))
  const coaches = team.staff.map((member, index): TeamProfileCoach => {
    const saved = legacyProfile?.coaches.find((coach) => coach.name.toLocaleLowerCase() === member.name.toLocaleLowerCase())
      ?? legacyProfile?.coaches[index]
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
  manualMatchSelected.value = false
  manualOpponentName.value = ''
}

function chooseManualMatch() {
  selectedMatchId.value = ''
  manualMatchSelected.value = true
}

function formatMatchDate(match: ZoebasMatch) {
  const date = new Date(`${match.date}T${match.startTime}:00`)
  return `${date.toLocaleDateString()} · ${match.startTime}`
}

watch([selectedCatalogTeamId, () => props.catalogTeams], async ([teamId]) => {
  matches.value = []
  selectedMatchId.value = ''
  manualMatchSelected.value = false
  manualOpponentName.value = ''
  matchError.value = ''
  if (!props.catalogTeams.length) return
  if (!props.catalogTeams.some((team) => team.id === teamId)) {
    selectedCatalogTeamId.value = props.catalogTeams[0].id
    return
  }
  if (!teamId) return

  const team = props.catalogTeams.find((item) => item.id === teamId)
  if (!team) return
  selectCatalogTeam(teamId)
  matchLoading.value = true
  try {
    const fetchedMatches = await loadZoebasMatches(team.sourceTeamId)
    if (selectedCatalogTeamId.value !== teamId) return
    matches.value = fetchedMatches
    const suggested = getRecommendedMatch(fetchedMatches)
    if (suggested) selectedMatchId.value = suggested.id
  } catch (error) {
    console.error('Failed to load the Zoebas match schedule.', error)
    if (selectedCatalogTeamId.value === teamId) matchError.value = t('errors.loadMatchSchedule')
  } finally {
    if (selectedCatalogTeamId.value === teamId) matchLoading.value = false
  }
}, { immediate: true })

function addTeam() {
  const id = crypto.randomUUID()
  const players = Array.from({ length: 5 }, (): TeamProfilePlayer => ({
    id: crypto.randomUUID(),
    name: '',
    jerseyNumber: '',
    isParticipating: false,
    isOnCourt: false,
  }))
  draftProfiles.value.push({ id, name: '', players, coaches: [] })
  updateSelectedProfile(id)
}

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

function removePlayer(playerId: string) {
  if (!currentProfile.value) return
  currentProfile.value.players = currentProfile.value.players.filter((player) => player.id !== playerId)
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

function removeCoach(coachId: string) {
  if (!currentProfile.value) return
  currentProfile.value.coaches = currentProfile.value.coaches.filter((coach) => coach.id !== coachId)
}

function toggleCoachParticipation(coach: TeamProfileCoach) {
  coach.isParticipating = !coach.isParticipating
}

function toggleParticipation(player: TeamProfilePlayer) {
  player.isParticipating = !player.isParticipating
  if (!player.isParticipating) player.isOnCourt = false
}

function toggleCourt(player: TeamProfilePlayer) {
  if (player.isOnCourt) player.isOnCourt = false
  else if (player.isParticipating && currentPlayersOnCourt.value < 5) player.isOnCourt = true
}

function participantError(profile: TeamProfile | undefined) {
  if (!profile?.name.trim()) return t('teamSetup.teamNameRequired')
  const participants = profile.players.filter((player) => player.isParticipating)
  if (participants.length < 5) return t('teamSetup.selectAtLeastFive')
  if (participants.some((player) => !player.name.trim() || !/^\d{1,2}$/.test(player.jerseyNumber))) {
    return t('teamSetup.participantDetailsRequired')
  }
  if (new Set(participants.map((player) => Number(player.jerseyNumber))).size !== participants.length) {
    return t('teamSetup.duplicateNumbers')
  }
  return ''
}

function profileError(profile: TeamProfile | undefined) {
  if (!profile) return t('teamSetup.teamNameRequired')
  const participationError = participantError(profile)
  if (participationError) return participationError
  if (profile.players.filter((player) => player.isOnCourt).length !== 5) return t('teamSetup.selectFive')
  return ''
}

const currentStepError = computed(() =>
  props.catalogError && isSelectingHomeParticipants.value
    ? props.catalogError
    : isSelectingParticipants.value
      ? participantError(currentProfile.value ?? undefined)
      : profileError(currentProfile.value ?? undefined),
)

const canAdvance = computed(() => !selectionError.value
  && (!isSelectingHomeParticipants.value
    || (!!props.catalogTeams.find((team) => team.id === selectedCatalogTeamId.value) && hasMatchSelection.value))
  && !currentStepError.value)

const canSave = computed(() => !selectionError.value
  && sides.every((_, index) => !profileError(draftProfiles.value.find((profile) => profile.id === selected.value[index]))))

function save() {
  if (!canSave.value) return
  emit('save', draftProfiles.value, [...selected.value], selectedMatch.value, manualOpponentName.value.trim())
}

function advance() {
  if (!canAdvance.value) return
  if (step.value === steps.length - 1) save()
  else step.value++
}

function canNavigateTo(index: number) {
  return index <= step.value || (index === step.value + 1 && canAdvance.value)
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
      aria-labelledby="team-setup-title"
    >
      <header class="team-setup-header">
        <div>
          <p class="eyebrow">{{ t('teamSetup.eyebrow') }}</p>
          <h2 id="team-setup-title">{{ t('teamSetup.title') }}</h2>
        </div>
        <button v-if="canCancel" class="team-setup-close" type="button" :aria-label="t('teamSetup.cancel')" @click="emit('cancel')">×</button>
      </header>
      <p v-if="error || catalogError" class="notice team-setup-notice" role="alert">{{ error || catalogError }}</p>

      <div class="team-setup-steps" :class="{ 'team-setup-home-steps': home }" role="tablist" :aria-label="t('teamSetup.title')">
        <button
          v-for="(wizardStep, index) in steps"
          :key="`${wizardStep.side}-${wizardStep.stage}`"
          type="button"
          :disabled="!canNavigateTo(index)"
          role="tab"
          :aria-selected="step === index"
          :class="{ selected: step === index }"
          @click="step = index"
        >{{ `${t(`teamSetup.${sides[wizardStep.side]}`)} · ${t(`teamSetup.${wizardStep.stage}`)}` }}</button>
      </div>

      <div class="team-setup-team" :class="{ 'team-setup-home-participants': isSelectingHomeParticipants }">
        <template v-if="isSelectingHomeParticipants">
          <label class="team-setup-field team-setup-club-picker">
            <span>{{ t('teamSetup.chooseClubTeam') }}</span>
            <select
              :value="selectedCatalogTeamId"
              :disabled="catalogLoading || catalogTeams.length === 0"
              @change="selectCatalogTeam(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t(catalogLoading ? 'teamSetup.loadingClubTeams' : 'teamSetup.chooseClubTeamPlaceholder') }}</option>
              <option v-for="team in catalogTeams" :key="team.id" :value="team.id">{{ team.name }}</option>
            </select>
          </label>
        </template>
        <template v-if="currentProfile && (!isSelectingHomeParticipants || selectedCatalogTeamId)">
        <div class="team-setup-profile-row">
          <label v-if="sideIndex === 1" class="team-setup-field">
            <span>{{ t('teamSetup.chooseTeam') }}</span>
            <select :value="currentProfileId" @change="updateSelectedProfile(($event.target as HTMLSelectElement).value)">
              <option v-for="profile in opponentProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name || t('teamSetup.unnamedTeam') }}
              </option>
            </select>
          </label>
          <p v-else class="team-setup-club-name">{{ currentProfile.name }}</p>
          <button v-if="sideIndex === 1" class="team-setup-add-team" type="button" @click="addTeam">{{ t('teamSetup.newTeam') }}</button>
        </div>

        <label v-if="sideIndex === 1" class="team-setup-field team-setup-name">
          <span>{{ t('teamSetup.teamName') }}</span>
          <input v-model="currentProfile.name" type="text" :placeholder="t('teamSetup.teamName')" maxlength="60">
        </label>

        <div class="team-setup-roster-heading">
          <h3>{{ t(isSelectingParticipants ? 'teamSetup.players' : 'teamSetup.startingFive') }}</h3>
          <span>{{ t(isSelectingParticipants ? 'teamSetup.participantCount' : 'teamSetup.onCourtCount', { count: isSelectingParticipants ? participatingMembersCount : currentPlayersOnCourt }) }}</span>
        </div>
        <p class="team-setup-hint">{{ t(isSelectingParticipants ? 'teamSetup.participantHint' : 'teamSetup.starterHint') }}</p>

        <section v-if="isSelectingHomeParticipants" class="team-setup-matches" aria-labelledby="team-match-heading">
          <h3 id="team-match-heading">{{ t('teamSetup.chooseMatch') }}</h3>
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
          <button class="team-setup-manual-match" type="button" :aria-pressed="manualMatchSelected" @click="chooseManualMatch">
            {{ t('teamSetup.manualMatch') }}
          </button>
          <label v-if="manualMatchSelected" class="team-setup-field">
            <span>{{ t('teamSetup.manualOpponent') }}</span>
            <input v-model="manualOpponentName" type="text" maxlength="60" :placeholder="t('teamSetup.manualOpponent')">
          </label>
          <p v-if="!hasMatchSelection" class="team-setup-error">{{ t('teamSetup.chooseMatchRequired') }}</p>
        </section>

        <div class="team-setup-roster">
          <div v-for="player in visiblePlayers" :key="player.id" class="team-setup-player">
            <button
              v-if="isSelectingParticipants"
              class="team-setup-court-toggle"
              type="button"
              :aria-pressed="player.isParticipating"
              :aria-label="t(player.isParticipating ? 'teamSetup.removeParticipant' : 'teamSetup.addParticipant', { name: player.name || t('teamSetup.playerName') })"
              @click="toggleParticipation(player)"
            >{{ player.isParticipating ? '✓' : '+' }}</button>
            <button
              v-else
              class="team-setup-court-toggle"
              type="button"
              :aria-pressed="player.isOnCourt"
              :aria-label="t(player.isOnCourt ? 'teamSetup.removeFromCourt' : 'teamSetup.putOnCourt', { name: player.name || t('teamSetup.playerName') })"
              :disabled="!player.isParticipating"
              @click="toggleCourt(player)"
            >{{ player.isOnCourt ? '✓' : '+' }}</button>
            <input v-model="player.name" type="text" :aria-label="t('teamSetup.playerName')" :placeholder="t('teamSetup.playerName')" maxlength="60">
            <input v-model="player.jerseyNumber" type="text" inputmode="numeric" maxlength="2" :aria-label="t('teamSetup.jerseyNumber')" placeholder="#" @input="player.jerseyNumber = player.jerseyNumber.replace(/\D/g, '').slice(0, 2)">
            <button v-if="isSelectingParticipants" class="team-setup-remove-player" type="button" :aria-label="t('teamSetup.removePlayer')" @click="removePlayer(player.id)">×</button>
          </div>
        </div>
        <button v-if="isSelectingParticipants" class="team-setup-add-player" type="button" @click="addPlayer">+ {{ t('teamSetup.addPlayer') }}</button>
        <section v-if="isSelectingParticipants" class="team-setup-coaches" :aria-label="t('teamSetup.coaches')">
          <div class="team-setup-roster-heading">
            <h3>{{ t('teamSetup.coaches') }}</h3>
            <span>{{ t('teamSetup.coachesSelected', { count: currentProfile?.coaches.filter((coach) => coach.isParticipating).length ?? 0 }) }}</span>
          </div>
          <div class="team-setup-roster">
            <div v-for="coach in currentProfile?.coaches ?? []" :key="coach.id" class="team-setup-player team-setup-coach">
              <button
                class="team-setup-court-toggle"
                type="button"
                :aria-pressed="coach.isParticipating"
                :aria-label="t(coach.isParticipating ? 'teamSetup.removeCoach' : 'teamSetup.addCoach', { name: coach.name })"
                @click="toggleCoachParticipation(coach)"
              >{{ coach.isParticipating ? '✓' : '+' }}</button>
              <span class="team-setup-coach-name">{{ coach.name }} <small>{{ t(coach.role === 'assistant' ? 'teamSetup.assistantCoach' : 'teamSetup.coach') }}</small></span>
              <button
                v-if="!props.catalogTeams.find((team) => team.id === currentProfile?.catalogTeamId)?.staff.some((member) => member.name === coach.name)"
                class="team-setup-remove-player"
                type="button"
                :aria-label="t('teamSetup.removeCoach', { name: coach.name })"
                @click="removeCoach(coach.id)"
              >×</button>
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
        <p v-if="selectionError" class="team-setup-error" role="alert">{{ selectionError }}</p>
        </template>
      </div>

      <footer class="team-setup-footer">
        <button v-if="step > 0" class="team-setup-secondary" type="button" @click="step--">{{ t('teamSetup.back') }}</button>
        <button class="team-setup-primary" type="button" :disabled="step === steps.length - 1 ? !canSave : !canAdvance" @click="advance">{{ t(step === steps.length - 1 ? 'teamSetup.startGame' : 'teamSetup.next') }}</button>
      </footer>
    </section>
  </div>
</template>
