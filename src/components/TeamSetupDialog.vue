<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useLocale } from '../i18n/useLocale'
import { loadTeamSetupDraft, saveTeamSetupDraft, type TeamProfile, type TeamProfilePlayer, type TeamSetupDraft } from '../services/teamProfiles'
import { getRecommendedMatch, loadZoebasMatches, type ZoebasMatch } from '../services/zoebasMatches'
import type { ZoebasTeam } from '../services/zoebasTeams'
import { useSharedJerseyNumbers } from '../composables/useSharedJerseyNumbers'
import RosterEditor from './RosterEditor.vue'
import OpponentTeamInput from './OpponentTeamInput.vue'
import TeamLogo from './TeamLogo.vue'
import { useOpponentTeams } from '../composables/useOpponentTeams'
import BaseDialog from './BaseDialog.vue'
import AppButton from './ui/AppButton.vue'
import { loadStatisticsRoster, loadStatisticsTeams, type StatisticsPlayer } from '../services/statistics'
import { getSupabaseClient } from '../services/supabaseClient'
import { groupTeams, teamGroupLabelKeys } from '../domain/schedule'

const props = defineProps<{
  profiles: TeamProfile[]
  selectedProfileIds: [string, string]
  catalogTeams: ZoebasTeam[]
  catalogLoading: boolean
  catalogError: string
  catalogCached?: boolean
  localOnly?: boolean
  practice?: boolean
  canCancel: boolean
  error: string
  home?: boolean
  rosterProfile?: TeamProfile
  requireOnCourt?: boolean
}>()

const emit = defineEmits<{
  cancel: []
  save: [profiles: TeamProfile[], selectedProfileIds: [string, string], match: ZoebasMatch | null, manualOpponentName: string, manualStart: string, opponentClub: string]
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
const { teams: opponentTeams, refreshOpponentTeams } = useOpponentTeams()
const manualStart = ref('')
type OpponentPlayerDraft = { id: string; name: string; jerseyNumber: string }
const newOpponentPlayer = (): OpponentPlayerDraft => ({ id: crypto.randomUUID(), name: '', jerseyNumber: '' })
const opponentPlayers = ref<OpponentPlayerDraft[]>(Array.from({ length: 5 }, (_, index) => ({
  id: crypto.randomUUID(),
  name: t('teamSetup.defaultOpponentPlayer', { number: index + 4 }),
  jerseyNumber: String(index + 4),
})))
const opponentTeamName = ref('')
// A practice opponent keeps its club apart; without a team the club name is the team name.
const practiceOpponentName = computed(() => opponentTeamName.value.trim() || manualOpponentName.value.trim())
const enteredOpponentPlayers = computed(() => opponentPlayers.value.filter((player) => player.name.trim() || player.jerseyNumber))
const opponentError = computed(() => {
  if (!manualOpponentName.value.trim()) return t('teamSetup.opponentNameRequired')
  const entered = enteredOpponentPlayers.value
  if (entered.some((player) => !player.name.trim() || !/^\d{1,2}$/.test(player.jerseyNumber))) {
    return t('teamSetup.participantDetailsRequired')
  }
  if (entered.length < 2) return t('teamSetup.opponentMinPlayers')
  if (new Set(entered.map((player) => Number(player.jerseyNumber))).size !== entered.length) return t('teamSetup.duplicateNumbers')
  return ''
})
const catalogPlayerIds = ref<string[]>([])
const sharedRoster = ref<StatisticsPlayer[]>([])
const sharedRosterError = ref('')
const sharedTeamIds = ref<string[]>([])
const localTeamName = ref('')
const availableTeams = computed(() => [
  ...props.catalogTeams.filter((team) => team.playerNames.length > 0 || sharedTeamIds.value.includes(team.id)),
  ...(props.localOnly ? draftProfiles.value.filter((profile) => profile.catalogTeamId?.startsWith('local-'))
    .map((profile): ZoebasTeam => ({ id: profile.catalogTeamId!, name: profile.name, sourceTeamId: '', playerNames: [] })) : []),
])
// Same sections as the favorite team picker; the catalog has no test teams.
const teamSections = computed(() => groupTeams([...new Set(availableTeams.value.map((team) => team.name))], new Set())
  .map((section) => ({
    group: section.group,
    teams: section.teams.flatMap((name) => availableTeams.value.filter((team) => team.name === name)),
  })))
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
  getTeam: () => availableTeams.value.find((team) =>
    team.id === (props.rosterProfile ? currentProfile.value?.catalogTeamId : selectedCatalogTeamId.value),
  ),
  catalogPlayerIds,
  initialBaselines: restoredDraft?.jerseyBaselines,
  restoredDraft: !!restoredDraft,
  useLocalOnly: () => !!props.catalogCached || !navigator.onLine || selectedCatalogTeamId.value.startsWith('local-'),
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
const hasMatchSelection = computed(() => props.practice ? !opponentError.value : !!selectedMatch.value || (
  !!manualOpponentName.value.trim() && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(manualStart.value)
  && Number.isFinite(new Date(manualStart.value).getTime())
))

onMounted(() => {
  if (!props.rosterProfile) void refreshOpponentTeams()
})

onMounted(async () => {
  if (!navigator.onLine || props.catalogCached) return
  try {
    const client = getSupabaseClient()
    if (!client) return
    const { data, error } = await client.auth.getSession()
    if (error) throw error
    if (data.session) {
      sharedTeamIds.value = (await loadStatisticsTeams()).map((team) => team.id)
      const rosterTeamId = props.rosterProfile?.catalogTeamId
      if (rosterTeamId && sharedTeamIds.value.includes(rosterTeamId)) {
        sharedRoster.value = await loadStatisticsRoster(rosterTeamId)
      }
    }
  } catch (error) {
    console.error('Failed to load shared teams.', error)
    sharedRosterError.value = t('statistics.rosterLoadError')
  }
})

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
  const team = availableTeams.value.find((item) => item.id === teamId)
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
  profile = {
    id: legacyProfile?.id ?? `zoebas-${team.id}`,
    name: team.name,
    catalogTeamId: team.id,
    players,
  }
  const profileIndex = draftProfiles.value.findIndex((item) => item.id === profile?.id)
  if (profileIndex >= 0) draftProfiles.value.splice(profileIndex, 1, profile)
  else draftProfiles.value.push(profile)
  selected.value[0] = profile.id
  catalogPlayerIds.value = players.slice(0, team.playerNames.length).map((player) => player.id)
}

function addLocalTeam() {
  const name = localTeamName.value.trim()
  if (!name) return
  const id = `local-${crypto.randomUUID()}`
  draftProfiles.value.push({
    id, name, catalogTeamId: id,
    players: Array.from({ length: 5 }, (_, index) => ({
      id: `${id}-player-${index + 1}`, name: '', jerseyNumber: '', isParticipating: false, isOnCourt: false,
    })),
  })
  selectedCatalogTeamId.value = id
  localTeamName.value = ''
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
  if (!teamId) return

  const team = availableTeams.value.find((item) => item.id === teamId)
  if (!team) return
  selectCatalogTeam(teamId)
  sharedRoster.value = []
  sharedRosterError.value = ''
  if (!props.catalogCached && navigator.onLine && !team.id.startsWith('local-')) {
    try {
      const client = getSupabaseClient()
      const { data, error } = client ? await client.auth.getSession() : { data: { session: null }, error: null }
      if (error) throw error
      if (data.session && (await loadStatisticsTeams()).some((item) => item.id === teamId)) {
        const roster = await loadStatisticsRoster(teamId)
        if (request === matchRequest) sharedRoster.value = roster
      }
    } catch (error) {
      console.error('Failed to load the shared roster.', error)
      if (request === matchRequest) sharedRosterError.value = t('statistics.rosterLoadError')
    }
  }
  if (request !== matchRequest) return
  void loadJerseys(team, false)
  if (props.practice || props.catalogCached || !navigator.onLine || team.id.startsWith('local-')) return
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

function useSharedRoster() {
  const profile = currentProfile.value
  if (!profile) return
  const sharedIds = new Set(sharedRoster.value.map((player) => player.id))
  const shared = sharedRoster.value.map((player): TeamProfilePlayer => {
    const saved = profile.players.find((item) => item.id === player.id || item.id === `home-${player.id}`)
    const number = saved?.jerseyNumber || player.jerseyNumber
    return {
      id: player.id,
      name: player.isPrivate ? `Speler ${number}` : player.name ?? '',
      jerseyNumber: number,
      ...(player.isPrivate ? { statisticsPrivate: true } : {}),
      isParticipating: saved?.isParticipating ?? !props.rosterProfile,
      isOnCourt: saved?.isOnCourt ?? false,
    }
  })
  profile.players = [...shared, ...profile.players.filter((player) =>
    !sharedIds.has(player.id) && !(player.id.startsWith('home-') && sharedIds.has(player.id.slice(5))))
    .map((player) => props.rosterProfile ? { ...player } : { ...player, isParticipating: false, isOnCourt: false })]
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
const validTeam = computed(() => (!props.catalogError || selectedCatalogTeamId.value.startsWith('local-'))
  && !jerseyLoading.value && !jerseyError.value && !!availableTeams.value.find((team) => team.id === selectedCatalogTeamId.value))
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
    name: (props.practice ? practiceOpponentName.value : manualOpponentName.value.trim()) || t('teamSetup.away'),
    players: props.practice
      ? enteredOpponentPlayers.value.map((player) => ({
          id: player.id,
          name: player.name.trim(),
          jerseyNumber: player.jerseyNumber,
          isParticipating: true,
          isOnCourt: false,
        }))
      : Array.from({ length: 5 }, (_, index) => ({
          id: `player-${index + 1}`,
          name: `player_${index + 1}`,
          jerseyNumber: String(index + 1),
          isParticipating: true,
          isOnCourt: true,
        })),
  }
  emit('save', [...draftProfiles.value.filter((profile) => profile.id !== opponentId), opponent], [selected.value[0], opponentId], props.practice ? null : selectedMatch.value, props.practice ? practiceOpponentName.value : manualOpponentName.value.trim(), props.practice ? '' : manualStart.value, props.practice ? manualOpponentName.value.trim() : '')
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
    :variant="home ? 'page' : 'wizard'"
    :size="home ? 'wide' : 'md'"
    :dialog-class="home ? 'team-setup-home-card' : ''"
    :modal="!home"
    :close-on-escape="canCancel && !jerseySaving"
    :label="t(rosterProfile ? 'scoreboard.editPlayers' : practice ? 'teamSetup.practiceTitle' : 'teamSetup.title')"
    @close="emit('cancel')"
  >
      <header v-if="canCancel" class="team-setup-header mb-3.5 flex justify-end max-sm:mb-2.5">
        <button class="team-setup-close size-8 rounded-full border border-line bg-white text-xl text-[#716f68]" type="button" :disabled="jerseySaving" :aria-label="t('teamSetup.cancel')" @click="emit('cancel')">×</button>
      </header>
      <p v-if="error || (!rosterProfile && catalogError) || draftStorageError" class="notice team-setup-notice mb-3 mt-0" role="alert">{{ error || catalogError || t(draftStorageError) }}</p>
      <div v-if="jerseyError" class="notice team-setup-notice mb-3 mt-0" role="alert">
        <p>{{ jerseyError }}</p>
        <button type="button" :disabled="jerseyLoading || jerseySaving" @click="reloadJerseys">{{ t('teamSetup.reloadJerseys') }}</button>
      </div>

      <h2 v-if="rosterProfile">{{ t('scoreboard.editPlayers') }}</h2>
      <div v-else class="team-setup-steps mb-4 grid grid-cols-3 gap-[7px] max-sm:mb-2.5" role="tablist" :aria-label="t('teamSetup.title')">
        <button
          v-for="(wizardStep, index) in steps"
          :key="wizardStep"
          type="button"
          :disabled="!canNavigateTo(index)"
          role="tab"
          :aria-selected="step === index"
          :aria-current="step === index ? 'step' : undefined"
          class="flex min-h-[42px] min-w-0 items-center justify-center gap-[5px] rounded-[7px] border border-b-[3px] border-line bg-[#faf9f7] px-[3px] py-[5px] text-[11px] font-semibold text-[#77756e] disabled:opacity-60 [&.selected]:border-orange [&.selected]:bg-[#fff3ec] [&.selected]:text-[#984b2c] [&.selected_.team-setup-step-number]:bg-orange [&.selected_.team-setup-step-number]:text-white [&.completed]:border-b-[#478c59] [&.completed]:text-[#397f4c] [&.completed_.team-setup-step-number]:bg-[#478c59] [&.completed_.team-setup-step-number]:text-white"
          :class="{ selected: step === index, completed: stepCompleted(index) && step !== index }"
          @click="navigateTo(index)"
        ><span class="team-setup-step-number grid size-5 shrink-0 basis-5 place-items-center rounded-full bg-[#e8e6e1] text-[10px] text-[#77756e]" aria-hidden="true">{{ stepCompleted(index) && step !== index ? '✓' : index + 1 }}</span><span class="team-setup-step-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ index === 0 && validTeam ? currentProfile?.name : t(`teamSetup.${wizardStep}`) }}</span></button>
      </div>

      <div ref="stepContent" class="team-setup-team min-h-0 overflow-y-auto [&_.team-setup-error]:mt-2 [&_.team-setup-error]:text-[11px] [&_.team-setup-error]:text-[#b9472c] [&_.team-setup-field]:flex [&_.team-setup-field]:min-w-0 [&_.team-setup-field]:flex-1 [&_.team-setup-field]:flex-col [&_.team-setup-field]:gap-[5px] [&_.team-setup-field]:text-[10px] [&_.team-setup-field]:font-semibold [&_.team-setup-field]:text-[#77756e] [&_.team-setup-hint]:mt-1 [&_.team-setup-hint]:mb-[9px] [&_.team-setup-hint]:text-[10px] [&_.team-setup-hint]:leading-[1.4] [&_.team-setup-hint]:text-[#85827b] [&_.team-setup-matches]:mt-[13px] [&_.team-setup-matches]:grid [&_.team-setup-matches]:gap-[7px] [&_.team-setup-matches_h3]:m-0 [&_.team-setup-matches_h3]:text-xs [&_.team-setup-matches_h3]:text-ink [&_.team-setup-matches_h4]:m-0 [&_.team-setup-matches_h4]:mt-[5px] [&_.team-setup-matches_h4]:text-xs [&_.team-setup-matches_h4]:text-ink [&_.team-setup-player_input]:min-h-[37px] [&_.team-setup-player_input]:min-w-0 [&_.team-setup-player_input]:rounded-md [&_.team-setup-player_input]:border [&_.team-setup-player_input]:border-line [&_.team-setup-player_input]:bg-white [&_.team-setup-player_input]:px-[9px] [&_.team-setup-player_input]:py-[7px] [&_.team-setup-player_input]:text-xs [&_.team-setup-player_input]:text-ink [&_.team-setup-field_input]:min-h-[37px] [&_.team-setup-field_input]:min-w-0 [&_.team-setup-field_input]:rounded-md [&_.team-setup-field_input]:border [&_.team-setup-field_input]:border-line [&_.team-setup-field_input]:bg-white [&_.team-setup-field_input]:px-[9px] [&_.team-setup-field_input]:py-[7px] [&_.team-setup-field_input]:text-xs [&_.team-setup-field_input]:text-ink [&_.team-setup-field_select]:min-h-[37px] [&_.team-setup-field_select]:min-w-0 [&_.team-setup-field_select]:rounded-md [&_.team-setup-field_select]:border [&_.team-setup-field_select]:border-line [&_.team-setup-field_select]:bg-white [&_.team-setup-field_select]:px-[9px] [&_.team-setup-field_select]:py-[7px] [&_.team-setup-field_select]:text-xs [&_.team-setup-field_select]:text-ink dark:[&_.team-setup-player_input]:bg-control dark:[&_.team-setup-field_input]:bg-control dark:[&_.team-setup-field_select]:bg-control">
        <template v-if="step === 0">
          <h3>{{ t('teamSetup.chooseClubTeam') }}</h3>
          <p v-if="practice" class="team-setup-hint">{{ t('teamSetup.practiceHint') }}</p>
          <p v-if="catalogLoading" class="team-setup-hint" role="status">{{ t('teamSetup.loadingClubTeams') }}</p>
          <p v-if="catalogCached" class="team-setup-hint" role="status">{{ t('teamSetup.cachedTeams') }}</p>
          <p v-else-if="!catalogError && !availableTeams.length" class="team-setup-hint" role="status">{{ t('teamSetup.noTeamsWithPlayers') }}</p>
          <div v-for="section in teamSections" :key="section.group" class="favorite-team-section">
            <h3 :id="`team-group-${section.group}`">{{ t(teamGroupLabelKeys[section.group]) }}</h3>
            <div class="team-setup-team-grid grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2" role="group" :aria-labelledby="`team-group-${section.group}`">
              <button v-for="team in section.teams" :key="team.id" type="button"
                class="flex min-h-12 items-center justify-center gap-2 rounded-[7px] border border-line bg-panel p-2 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-orange focus-visible:outline-offset-2 aria-pressed:border-orange aria-pressed:bg-[color-mix(in_srgb,var(--orange)_12%,var(--panel))]"
                :aria-pressed="selectedCatalogTeamId === team.id" :disabled="jerseySaving"
                @click="selectedCatalogTeamId = team.id"><TeamLogo :name="team.name" /><span>{{ team.name }}</span></button>
            </div>
          </div>
          <div v-if="localOnly" class="team-setup-field flex min-w-0 flex-1 flex-col gap-[5px] text-[10px] font-semibold text-[#77756e]">
            <label for="local-team-name">{{ t('sessions.localTeam') }}</label>
            <input id="local-team-name" v-model="localTeamName" type="text" maxlength="60">
            <AppButton :disabled="!localTeamName.trim()" @click="addLocalTeam">{{ t('sessions.addLocalTeam') }}</AppButton>
          </div>
        </template>
        <section v-if="step === 2 && practice" class="team-setup-matches" aria-labelledby="practice-opponent-heading">
          <h3 id="practice-opponent-heading">{{ t('teamSetup.practiceOpponent') }}</h3>
          <p class="team-setup-hint">{{ t('teamSetup.practiceOpponentHint') }}</p>
          <OpponentTeamInput v-model="manualOpponentName" :teams="opponentTeams" :label="t('teamSetup.opponentClub')" :placeholder="t('teamSetup.opponentClub')" />
          <label class="team-setup-field">
            <span>{{ t('teamSetup.opponentTeam') }}</span>
            <input v-model="opponentTeamName" type="text" maxlength="40" :placeholder="t('teamSetup.opponentTeamPlaceholder')">
          </label>
          <div class="team-setup-roster-heading mt-4 flex items-center justify-between gap-2">
            <h4 class="m-0 text-[13px] text-[#6f6d67]">{{ t('teamSetup.opponentPlayers') }}</h4>
            <span class="text-[10px] text-[#85827b]">{{ t('teamSetup.participantCount', { count: enteredOpponentPlayers.length }) }}</span>
          </div>
          <div class="team-setup-player team-setup-column-heading mb-[5px] grid grid-cols-[54px_minmax(0,1fr)_76px] gap-1.5 text-[10px] font-semibold text-muted max-xs:grid-cols-[44px_minmax(0,1fr)_76px] max-xs:gap-1 [&>span:first-child]:text-center [&>span:last-child]:text-center" aria-hidden="true">
            <span>#</span><span>{{ t('teamSetup.name') }}</span><span></span>
          </div>
          <div class="team-setup-roster grid gap-1.5">
            <div v-for="player in opponentPlayers" :key="player.id" class="team-setup-player grid grid-cols-[54px_minmax(0,1fr)_76px] gap-1.5 max-xs:grid-cols-[44px_minmax(0,1fr)_76px] max-xs:gap-1 [&_input]:w-full">
              <input v-model="player.jerseyNumber" class="team-setup-jersey-input text-center" type="text" inputmode="numeric" maxlength="2" :aria-label="t('teamSetup.jerseyNumber')" placeholder="#" @input="player.jerseyNumber = player.jerseyNumber.replace(/\D/g, '').slice(0, 2)">
              <input v-model="player.name" type="text" :aria-label="t('teamSetup.playerName')" :placeholder="t('teamSetup.playerName')" maxlength="60">
              <button class="team-setup-opponent-remove min-h-9 min-w-9 justify-self-center rounded-md border border-line bg-transparent text-base text-muted" type="button" :aria-label="t('teamSetup.removePlayer')" :title="t('teamSetup.removePlayer')" @click="opponentPlayers = opponentPlayers.filter((item) => item.id !== player.id)">×</button>
            </div>
          </div>
          <button class="team-setup-add-player mt-2 min-h-[37px] w-full rounded-md border border-line bg-white px-2.5 text-[11px] font-semibold whitespace-nowrap text-[#5f5d57]" type="button" @click="opponentPlayers.push(newOpponentPlayer())">+ {{ t('teamSetup.addPlayer') }}</button>
          <p v-if="opponentError" class="team-setup-error">{{ opponentError }}</p>
        </section>
        <section v-if="step === 2 && !practice" class="team-setup-matches" aria-labelledby="team-match-heading">
          <h3 id="team-match-heading">{{ t('teamSetup.chooseMatch') }}</h3>
          <OpponentTeamInput v-model="manualOpponentName" :teams="opponentTeams" :label="t('teamSetup.manualOpponent')" :placeholder="t('teamSetup.manualOpponent')" @update:model-value="selectManualMatch" />
          <label v-if="manualOpponentName.trim()" class="team-setup-field">
            <span>{{ t('teamSetup.startTime') }}</span>
            <input v-model="manualStart" type="datetime-local" required>
          </label>
          <p v-if="matchLoading" class="team-setup-hint" role="status">{{ t('teamSetup.loadingMatches') }}</p>
          <p v-if="matchError" class="team-setup-error" role="alert">{{ matchError }}</p>
          <template v-else-if="!matchLoading && matches.length">
            <h4>{{ t('teamSetup.program') }}</h4>
            <p v-if="!upcomingMatches.length" class="team-setup-hint">{{ t('teamSetup.noUpcomingMatches') }}</p>
            <button
              v-for="match in upcomingMatches"
              :key="match.id"
              class="team-setup-match-option grid gap-[3px] rounded-[7px] border border-line bg-panel p-[9px_10px] text-left text-[10px] text-ink disabled:cursor-not-allowed disabled:opacity-55 [&.selected]:border-orange [&.selected]:bg-[color-mix(in_srgb,var(--orange)_8%,var(--panel))] [&>span]:text-muted [&_strong]:text-[11px]"
              :class="{ selected: selectedMatchId === match.id }"
              type="button"
              :disabled="match.status === 'Cancelled'"
              :aria-pressed="selectedMatchId === match.id"
              @click="selectMatch(match)"
            >
              <span class="team-setup-match-date">{{ formatMatchDate(match) }}</span>
              <strong class="team-setup-match-teams flex flex-wrap items-center gap-1 [&_.team-logo]:size-5"><TeamLogo :name="match.homeTeamName" />{{ match.homeTeamName }} – <TeamLogo :name="match.awayTeamName" />{{ match.awayTeamName }}</strong>
              <span v-if="match.venue">{{ t('teamSetup.venue', { venue: match.venue }) }}</span>
              <span v-if="match.id === recommendedMatch?.id" class="team-setup-match-badge font-bold text-orange!">{{ t('teamSetup.recommendedMatch') }}</span>
              <span v-if="match.status === 'Cancelled'" class="team-setup-match-badge font-bold text-orange!">{{ t('teamSetup.cancelledMatch') }}</span>
            </button>
            <h4>{{ t('teamSetup.results') }}</h4>
            <p v-if="!pastMatches.length" class="team-setup-hint">{{ t('teamSetup.noPastMatches') }}</p>
            <button
              v-for="match in pastMatches"
              :key="match.id"
              class="team-setup-match-option grid gap-[3px] rounded-[7px] border border-line bg-panel p-[9px_10px] text-left text-[10px] text-ink disabled:cursor-not-allowed disabled:opacity-55 [&.selected]:border-orange [&.selected]:bg-[color-mix(in_srgb,var(--orange)_8%,var(--panel))] [&>span]:text-muted [&_strong]:text-[11px]"
              :class="{ selected: selectedMatchId === match.id }"
              type="button"
              :disabled="match.status === 'Cancelled'"
              :aria-pressed="selectedMatchId === match.id"
              @click="selectMatch(match)"
            >
              <span class="team-setup-match-date">{{ formatMatchDate(match) }}</span>
              <strong class="team-setup-match-teams flex flex-wrap items-center gap-1 [&_.team-logo]:size-5"><TeamLogo :name="match.homeTeamName" />{{ match.homeTeamName }} {{ match.homeScore ?? '–' }} – {{ match.awayScore ?? '–' }} <TeamLogo :name="match.awayTeamName" />{{ match.awayTeamName }}</strong>
              <span v-if="match.venue">{{ t('teamSetup.venue', { venue: match.venue }) }}</span>
              <span v-if="match.id === recommendedMatch?.id" class="team-setup-match-badge font-bold text-orange!">{{ t('teamSetup.recommendedMatch') }}</span>
              <span v-if="match.status === 'Cancelled'" class="team-setup-match-badge font-bold text-orange!">{{ t('teamSetup.cancelledMatch') }}</span>
            </button>
          </template>
          <p v-else-if="!matchLoading && !matchError" class="team-setup-hint">{{ t('teamSetup.noMatches') }}</p>
          <p v-if="!hasMatchSelection" class="team-setup-error">{{ t('teamSetup.chooseMatchRequired') }}</p>
        </section>

        <div v-if="currentProfile" v-show="step === 1">
          <p v-if="sharedRosterError" class="team-setup-error" role="alert">{{ sharedRosterError }}</p>
          <button v-if="sharedRoster.length" type="button" class="team-setup-add-player" @click="useSharedRoster">{{ t('statistics.useRoster') }}</button>
          <RosterEditor
            :profile="currentProfile"
            :disabled="jerseySaving || jerseyLoading"
            :clear-court-on-absence="!rosterProfile"
            :show-shared-jerseys-hint="(!rosterProfile || !!currentProfile.catalogTeamId) && !currentProfile.catalogTeamId?.startsWith('local-')"
            :error="currentStepError"
          />
        </div>
      </div>

      <footer class="team-setup-footer mt-3.5 flex justify-end gap-2">
        <button v-if="rosterProfile" class="team-setup-secondary min-h-[42px] rounded-[7px] border border-line bg-[#faf9f7] px-[15px] text-xs font-bold text-[#66645e] dark:bg-control dark:text-ink" type="button" :disabled="jerseySaving" @click="emit('cancel')">{{ t('teamSetup.cancel') }}</button>
        <button v-else-if="step > 0" class="team-setup-secondary min-h-[42px] rounded-[7px] border border-line bg-[#faf9f7] px-[15px] text-xs font-bold text-[#66645e] dark:bg-control dark:text-ink" type="button" :disabled="jerseySaving" @click="step--">{{ t('teamSetup.back') }}</button>
        <button v-if="rosterProfile" class="team-setup-primary min-h-[42px] rounded-[7px] border-0 bg-orange px-[15px] text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-[#e8e6e1] disabled:text-[#aaa79f] dark:disabled:bg-[#30343c] dark:disabled:text-[#8d929c]" type="button" :disabled="!canAdvance || jerseySaving || jerseyLoading" @click="saveRoster">{{ t('teamSetup.saveAndContinue') }}</button>
        <button v-else class="team-setup-primary min-h-[42px] rounded-[7px] border-0 bg-orange px-[15px] text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-[#e8e6e1] disabled:text-[#aaa79f] dark:disabled:bg-[#30343c] dark:disabled:text-[#8d929c]" type="button" :disabled="!canAdvance || jerseySaving" @click="advance">{{ t(step === steps.length - 1 ? 'teamSetup.saveAndContinue' : 'teamSetup.next') }}</button>
      </footer>
  </BaseDialog>
</template>
