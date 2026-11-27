<script setup lang="ts">
import ScorerRoleDialog from './ScorerRoleDialog.vue'
import ScheduleSide from './ScheduleSide.vue'
import AppButton from './ui/AppButton.vue'
import AppCard from './ui/AppCard.vue'
import AppNotice from './ui/AppNotice.vue'
import StatusBadge from './ui/StatusBadge.vue'
import { errorMessage } from '../domain/guards'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { gameStartMs, groupByDay, groupTeams, localDateKey, scheduleBucket, teamGroupLabelKeys, winnerSide, type ScheduleGame } from '../domain/schedule'
import { sessionPhase } from '../domain/sessionWindow'
import { createInitialGameState, type GameState } from '../domain/game'
import { useFavoriteTeams } from '../composables/useFavoriteTeams'
import { isZoebasName, withStartingColors } from '../composables/teamColors'
import { useOpponentTeams } from '../composables/useOpponentTeams'
import { useLocale } from '../i18n/useLocale'
import { joinMatchSession, listMatchSessions, openScheduleSession, setSessionFinal, transferMatchScorer, type MatchSession, type SessionStatus } from '../services/sharedMatch'
import { loadMatchScorers } from '../services/statistics'
import { loadSchedule } from '../services/zoebasSchedule'

export type OpenPracticeGame = { homeTeam: string; awayTeam: string; awayClub?: string | null; homeScore: number; awayScore: number; startTime: string }

const props = defineProps<{
  configured: boolean
  hasCurrentGame: boolean
  displayName: string
  currentMatchId: string | null
  practiceGame?: OpenPracticeGame | null
}>()
const emit = defineEmits<{
  resume: []
  join: [id: string, side: 'home' | 'away']
  view: [id: string]
  practice: []
}>()
const { t, locale } = useLocale()
const allSessions = ref<MatchSession[]>([])
// The game whose role is being chosen. Without a session nobody has started it yet; a viewer then opens the session without a scorer.
const roleGame = ref<{ game: ScheduleGame; sessionId: string | null } | null>(null)
const roleBusy = ref(false)
const checking = ref(false)
const error = ref('')
const loading = ref(false)
const now = ref(Date.now())
let timer: number | undefined
let lastRefresh = 0

const schedule = ref<ScheduleGame[]>([])
const scheduleError = ref('')
const { favorites, setFavorites } = useFavoriteTeams()
const { refreshOpponentTeams } = useOpponentTeams()
const mode = ref<'mine' | 'all'>(favorites.value.length ? 'mine' : 'all')
const editing = ref(false)
const draftFavorites = ref<string[]>([])
const testTeamNames = computed(() => new Set(schedule.value
  .filter((game) => game.id.startsWith('test-game'))
  .flatMap((game) => [game.homeTeam, game.awayTeam])))
const zoebasClubName = 'Zoebas'
// Only Zoebas teams (and test teams) are offered; opponent teams of other clubs are left out.
const zoebasTeamNames = computed(() => new Set(schedule.value.flatMap((game) => [
  game.homeClub === zoebasClubName ? game.homeTeam : null,
  game.awayClub === zoebasClubName ? game.awayTeam : null,
]).filter((name): name is string => name !== null)))
const teamNames = computed(() => [...new Set(schedule.value.flatMap((game) => [game.homeTeam, game.awayTeam]))]
  .filter((name) => zoebasTeamNames.value.has(name) || testTeamNames.value.has(name))
  .sort((left, right) => left.localeCompare(right)))
const teamSections = computed(() => groupTeams(teamNames.value, testTeamNames.value))

const showMine = computed(() => mode.value === 'mine' && favorites.value.length > 0)
const visibleSchedule = computed(() => showMine.value
  ? schedule.value.filter((game) => favorites.value.includes(game.homeTeam) || favorites.value.includes(game.awayTeam))
  : schedule.value)

function selectAll() {
  mode.value = 'all'
  editing.value = false
}

// Without favorites, "mijn teams" goes straight to choosing them.
function selectMine() {
  mode.value = 'mine'
  if (!favorites.value.length) startEditing()
  else editing.value = false
}

function startEditing() {
  draftFavorites.value = [...favorites.value]
  editing.value = true
}

function toggleDraft(teamName: string) {
  draftFavorites.value = draftFavorites.value.includes(teamName)
    ? draftFavorites.value.filter((name) => name !== teamName)
    : [...draftFavorites.value, teamName]
}

// Test teams are left out, so they are only ever selected by hand.
const selectableTeamNames = computed(() => teamNames.value.filter((name) => !testTeamNames.value.has(name)))
const allDraftSelected = computed(() => selectableTeamNames.value.length > 0
  && selectableTeamNames.value.every((name) => draftFavorites.value.includes(name)))

function pickAllTeams() {
  draftFavorites.value = [...selectableTeamNames.value]
}

function clearTeams() {
  draftFavorites.value = []
}

function saveMyTeams() {
  setFavorites(draftFavorites.value)
  mode.value = favorites.value.length ? 'mine' : 'all'
  editing.value = false
  void refresh()
}

const openGames = computed(() => visibleSchedule.value.filter((game) => scheduleBucket(game, now.value) === 'open'))
const upcomingDays = computed(() => groupByDay(visibleSchedule.value.filter((game) => scheduleBucket(game, now.value) === 'upcoming')))
const historyGames = computed(() => visibleSchedule.value
  .filter((game) => scheduleBucket(game, now.value) === 'history')
  .sort((left, right) => gameStartMs(right) - gameStartMs(left)))
const historyDays = computed(() => groupByDay(historyGames.value))

function sessionForGame(game: ScheduleGame) {
  return allSessions.value.find((session) => session.scheduleId === game.id)
}

function canJoinSession(session: MatchSession | undefined) {
  return !!session && (session.status === 'open' || session.status === 'live')
}

function scheduleGameState(game: ScheduleGame): GameState {
  const state = createInitialGameState()
  return {
    ...state,
    teams: withStartingColors(
      { id: 'home', name: game.homeTeam, ...(game.homeClub ? { club: game.homeClub } : {}), zoebas: isZoebasName(game.homeClub) || isZoebasName(game.homeTeam) },
      { id: 'away', name: game.awayTeam, ...(game.awayClub ? { club: game.awayClub } : {}), zoebas: isZoebasName(game.awayClub) || isZoebasName(game.awayTeam) },
    ),
    players: [],
    matchInfo: { id: game.id, date: game.date, startTime: game.startTime, venue: game.venue, startsAt: new Date(gameStartMs(game)).toISOString() },
  }
}

// The first scorer opens the session for a scheduled game and becomes its scorer; later joiners get the same session back.
async function startScheduleSession(game: ScheduleGame, side: 'home' | 'away') {
  error.value = ''
  try {
    const joined = await openScheduleSession(game.id, scheduleGameState(game), props.displayName)
    await transferMatchScorer(joined.link.matchId)
    emit('join', joined.link.matchId, side)
    await refresh()
  } catch (reason) {
    console.error('Failed to open the scheduled session.', reason)
    error.value = claimMessage(reason)
  }
}

function claimMessage(reason: unknown) {
  const message = errorMessage(reason)
  if (message.includes('several scorers')) return t('roles.claimMultiple')
  if (message.includes('not possible')) return t('roles.claimFailed')
  return message
}

async function finalizeSession(id: string) {
  error.value = ''
  try {
    await setSessionFinal(id)
    await refresh()
  } catch (reason) {
    console.error('Failed to finalise the session.', reason)
    error.value = errorMessage(reason)
  }
}

function isCurrentGame(game: ScheduleGame) {
  return !!props.currentMatchId && sessionForGame(game)?.id === props.currentMatchId
}

function canPick(game: ScheduleGame) {
  if (isCurrentGame(game)) return true
  if (props.hasCurrentGame) return false
  const session = sessionForGame(game)
  if (session) return canJoinSession(session)
  return sessionPhase(new Date(gameStartMs(game)).toISOString(), now.value) === 'open'
}

// Tapping your own running game resumes it. Any other open game first finds out whether it already has a scorer:
// then you can only watch, otherwise you choose between scoring and watching.
async function tapGame(game: ScheduleGame) {
  if (isCurrentGame(game)) { emit('resume'); return }
  if (checking.value) return
  error.value = ''
  const session = sessionForGame(game)
  if (!session) {
    roleGame.value = { game, sessionId: null }
    return
  }
  checking.value = true
  try {
    // Joining only gives read access; the role is decided afterwards.
    const joined = await joinMatchSession(session.id, props.displayName)
    const info = await loadMatchScorers(session.id)
    if (!info.scorerId) roleGame.value = { game, sessionId: session.id }
    else if (info.scorerId === joined.link.trackerId) emit('join', session.id, 'home')
    else emit('view', session.id)
  } catch (reason) {
    console.error('Failed to open the game.', reason)
    error.value = errorMessage(reason)
  } finally {
    checking.value = false
  }
}

async function chooseViewer() {
  const target = roleGame.value
  if (!target || roleBusy.value) return
  roleBusy.value = true
  error.value = ''
  try {
    // Opening the session creates it without a scorer, so the viewer can follow until someone scores.
    const sessionId = target.sessionId
      ?? (await openScheduleSession(target.game.id, scheduleGameState(target.game), props.displayName)).link.matchId
    roleGame.value = null
    emit('view', sessionId)
  } catch (reason) {
    console.error('Failed to open the game for viewing.', reason)
    error.value = errorMessage(reason)
  } finally {
    roleBusy.value = false
  }
}

async function chooseScorer(side: 'home' | 'away') {
  const target = roleGame.value
  if (!target || roleBusy.value) return
  roleBusy.value = true
  try {
    if (target.sessionId) {
      await transferMatchScorer(target.sessionId)
      emit('join', target.sessionId, side)
    } else {
      await startScheduleSession(target.game, side)
    }
  } catch (reason) {
    console.error('Failed to become the scorer.', reason)
    error.value = claimMessage(reason)
  } finally {
    roleGame.value = null
    roleBusy.value = false
  }
}

function statusLabel(status: SessionStatus) {
  return t(`sessions.status.${status}`)
}

function isLiveGame(game: ScheduleGame) {
  return sessionForGame(game)?.status === 'live'
}

function formatDay(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' })
}

// Today's games and the next day with games start expanded; later days stay collapsed.
function isExpandedDay(date: string, index: number) {
  return date === localDateKey(new Date(now.value)) || index === 0
}

async function refreshSchedule() {
  try {
    schedule.value = await loadSchedule()
    scheduleError.value = ''
  } catch (reason) {
    console.error('Failed to load the schedule.', reason)
    scheduleError.value = errorMessage(reason)
  }
  void refreshOpponentTeams()
}

async function refresh() {
  if (loading.value || !props.configured) return
  lastRefresh = Date.now()
  loading.value = true
  try {
    allSessions.value = await listMatchSessions(true)
    error.value = ''
    await refreshSchedule()
  } catch (reason) {
    console.error('Failed to load match sessions.', reason)
    error.value = errorMessage(reason)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
  window.addEventListener('online', refresh)
  timer = window.setInterval(() => {
    now.value = Date.now()
    if (now.value - lastRefresh >= 30_000) void refresh()
  }, 10_000)
})
onUnmounted(() => {
  window.removeEventListener('online', refresh)
  if (timer !== undefined) window.clearInterval(timer)
})
</script>

<template>
  <section class="sessions-page grid gap-4 pb-8">
    <div class="landing-toggle inline-flex justify-self-center gap-0.5 rounded-full border border-line p-[3px]" role="group" :aria-label="t('sessions.myTeams')">
      <button type="button" class="cursor-pointer rounded-full border-0 bg-transparent px-3.5 py-1.5 font-bold text-inherit opacity-60 [&.is-active]:bg-orange [&.is-active]:text-white [&.is-active]:opacity-100" :class="{ 'is-active': mode === 'mine' }" :aria-pressed="mode === 'mine' ? 'true' : 'false'" @click="selectMine">{{ t('sessions.myTeams') }}</button>
      <button type="button" class="cursor-pointer rounded-full border-0 bg-transparent px-3.5 py-1.5 font-bold text-inherit opacity-60 [&.is-active]:bg-orange [&.is-active]:text-white [&.is-active]:opacity-100" :class="{ 'is-active': mode === 'all' }" :aria-pressed="mode === 'all' ? 'true' : 'false'" @click="selectAll">{{ t('sessions.allTeams') }}</button>
    </div>
    <AppNotice v-if="!configured" tone="error">{{ t('sync.notConfigured') }}</AppNotice>
    <AppNotice v-if="error" tone="error" role="alert">{{ t('sessions.loadError') }}: {{ error }}</AppNotice>
    <p v-if="checking" class="statistics-hint" role="status">{{ t('roles.checking') }}</p>
    <AppNotice v-if="scheduleError" tone="error" role="alert">{{ t('sessions.scheduleError') }}: {{ scheduleError }}</AppNotice>
    <AppCard v-if="editing" class="my-teams-editor" :title="t('sessions.pickMyTeams')">
      <div class="session-actions flex flex-wrap gap-2">
        <AppButton :disabled="allDraftSelected" @click="pickAllTeams">{{ t('sessions.selectAllTeams') }}</AppButton>
        <AppButton :disabled="!draftFavorites.length" @click="clearTeams">{{ t('sessions.deselectAllTeams') }}</AppButton>
      </div>
      <div v-for="section in teamSections" :key="section.group" class="favorite-team-section mb-3 grid gap-1.5">
        <h3 class="m-0 text-[0.95em] opacity-75">{{ t(teamGroupLabelKeys[section.group]) }}</h3>
        <div class="favorite-team-grid grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 p-0.5">
          <button
            v-for="name in section.teams"
            :key="name"
            type="button"
            class="favorite-team-tile flex cursor-pointer items-center justify-between gap-1.5 rounded-[10px] border-2 border-line bg-transparent px-2 py-1.5 text-left text-[0.85em] font-semibold text-inherit [&.is-favorite]:border-[#e0457b] [&.is-favorite_.favorite-tile-heart]:text-[#e0457b]"
            :class="{ 'is-favorite': draftFavorites.includes(name) }"
            :aria-pressed="draftFavorites.includes(name) ? 'true' : 'false'"
            :aria-label="name"
            @click="toggleDraft(name)"
          >
            <span>{{ name }}</span>
            <span class="favorite-tile-heart text-[1.1em] leading-none text-line" aria-hidden="true">♥</span>
          </button>
        </div>
      </div>
      <div class="session-actions flex flex-wrap gap-2">
        <AppButton variant="primary" :disabled="!draftFavorites.length" @click="saveMyTeams">{{ t('sessions.saveMyTeams') }}</AppButton>
      </div>
    </AppCard>
    <template v-if="!editing">
    <AppCard>
      <p v-if="!openGames.length && !practiceGame" class="statistics-hint">{{ t('sessions.openEmpty') }}</p>
      <div v-if="!openGames.length && !practiceGame" class="session-actions flex flex-wrap gap-2">
        <AppButton variant="primary" :disabled="hasCurrentGame" @click="emit('practice')">{{ t('sessions.practiceStart') }}</AppButton>
      </div>
      <article v-if="practiceGame" class="session-row schedule-game is-live practice-open-game relative grid gap-1.5 border-t border-line py-3.5">
        <button type="button" class="schedule-open-trigger grid w-full cursor-pointer gap-1.5 border-0 bg-transparent p-0 text-left text-inherit after:absolute after:inset-0 after:rounded-[inherit] after:content-['']" @click="emit('resume')">
          <span class="schedule-match grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,1fr)] items-center gap-3">
            <ScheduleSide :team="practiceGame.homeTeam" :club="zoebasClubName" />
            <span class="schedule-center grid min-w-0 items-center justify-items-center gap-1 self-center text-center break-anywhere">
              <span class="schedule-venue text-[0.9em] opacity-75">{{ t('sessions.practiceBadge') }}</span>
              <span class="schedule-score is-live inline-flex animate-[live-score-pulse_1.6s_ease-in-out_infinite] flex-col items-center rounded-xl bg-[#e5484d] px-3.5 py-1 text-[2em] leading-[1.2] text-white motion-reduce:animate-none">
                <span>{{ practiceGame.homeScore }} – {{ practiceGame.awayScore }}</span>
                <span class="live-score-label text-[0.4em] font-bold tracking-[0.08em] uppercase">{{ statusLabel('live') }}</span>
              </span>
              <time class="schedule-time is-small text-[0.9em] leading-normal">{{ practiceGame.startTime }}</time>
            </span>
            <ScheduleSide :team="practiceGame.awayTeam" :club="practiceGame.awayClub" />
          </span>
        </button>
      </article>
      <article v-for="game in openGames" :key="game.id" class="session-row schedule-game relative grid gap-1.5 border-t border-line py-3.5" :class="{ 'is-live': sessionForGame(game)?.status === 'live' }">
        <button type="button" class="schedule-open-trigger grid w-full cursor-pointer gap-1.5 border-0 bg-transparent p-0 text-left text-inherit after:absolute after:inset-0 after:rounded-[inherit] after:content-['']" :disabled="!canPick(game)" @click="tapGame(game)">
          <span class="schedule-match grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,1fr)] items-center gap-3">
            <ScheduleSide :team="game.homeTeam" :club="game.homeClub" :logo-url="game.homeLogoUrl" />
            <span v-if="isLiveGame(game)" class="schedule-center grid min-w-0 items-center justify-items-center gap-1 self-center text-center break-anywhere">
              <span v-if="game.venue" class="schedule-venue text-[0.9em] opacity-75">{{ game.venue }}</span>
              <span class="schedule-score is-live inline-flex animate-[live-score-pulse_1.6s_ease-in-out_infinite] flex-col items-center rounded-xl bg-[#e5484d] px-3.5 py-1 text-[2em] leading-[1.2] text-white motion-reduce:animate-none">
                <span>{{ sessionForGame(game)?.homeScore ?? 0 }} – {{ sessionForGame(game)?.awayScore ?? 0 }}</span>
                <span class="live-score-label text-[0.4em] font-bold tracking-[0.08em] uppercase">{{ statusLabel('live') }}</span>
              </span>
              <time class="schedule-time is-small text-[0.9em] leading-normal">{{ game.startTime }}</time>
            </span>
            <span v-else class="schedule-center grid min-w-0 items-center justify-items-center gap-1 self-center text-center break-anywhere">
              <span v-if="game.venue" class="schedule-venue text-[0.9em] opacity-75">{{ game.venue }}</span>
              <time class="schedule-time text-[2em] leading-[1.2]">{{ game.startTime }}</time>
            </span>
            <ScheduleSide :team="game.awayTeam" :club="game.awayClub" :logo-url="game.awayLogoUrl" />
          </span>
        </button>
        <StatusBadge v-if="sessionForGame(game) && !isLiveGame(game)" :status="sessionForGame(game)!.status">{{ statusLabel(sessionForGame(game)!.status) }}</StatusBadge>
        <span v-else-if="!sessionForGame(game) && !canPick(game)" class="statistics-hint">{{ t('sessions.opensBefore') }}</span>
        <div v-if="sessionForGame(game)?.canReview && sessionForGame(game)?.status === 'in_review'" class="session-actions relative z-1 flex flex-wrap gap-2">
          <AppButton variant="primary" @click="finalizeSession(sessionForGame(game)!.id)">{{ t('sessions.finalise') }}</AppButton>
        </div>
      </article>
    </AppCard>
    <AppCard :title="t('sessions.upcomingTitle')">
      <p v-if="!upcomingDays.length" class="statistics-hint">{{ t('sessions.upcomingEmpty') }}</p>
      <details v-for="(day, index) in upcomingDays" :key="day.date" class="history-day border-t border-line py-2" :open="isExpandedDay(day.date, index)">
        <summary class="schedule-day-summary cursor-pointer py-1.5 font-bold capitalize [&_small]:ml-1.5 [&_small]:font-normal [&_small]:opacity-70">{{ formatDay(day.date) }} <small>{{ day.games.length }}</small></summary>
        <article v-for="game in day.games" :key="game.id" class="session-row schedule-game relative grid gap-1.5 border-t border-line py-3.5">
          <div class="schedule-match grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,1fr)] items-center gap-3">
            <ScheduleSide :team="game.homeTeam" :club="game.homeClub" :logo-url="game.homeLogoUrl" :position="game.homePosition" />
            <span class="schedule-center grid min-w-0 items-center justify-items-center gap-1 self-center text-center break-anywhere">
              <span v-if="game.venue" class="schedule-venue text-[0.9em] opacity-75">{{ game.venue }}</span>
              <time class="schedule-time text-[2em] leading-[1.2]">{{ game.startTime }}</time>
            </span>
            <ScheduleSide :team="game.awayTeam" :club="game.awayClub" :logo-url="game.awayLogoUrl" :position="game.awayPosition" />
          </div>
        </article>
      </details>
    </AppCard>
    <AppCard :title="t('sessions.historyTitle')">
      <p v-if="!historyGames.length" class="statistics-hint">{{ t('sessions.historyEmpty') }}</p>
      <details v-for="day in historyDays" :key="day.date" class="history-day border-t border-line py-2">
        <summary class="cursor-pointer py-1.5 font-bold capitalize [&_small]:ml-1.5 [&_small]:font-normal [&_small]:opacity-70">{{ formatDay(day.date) }} <small>{{ day.games.length }}</small></summary>
        <article v-for="game in day.games" :key="game.id" class="session-row schedule-game relative grid gap-1.5 border-t border-line py-3.5">
          <span class="stats-label justify-self-start rounded-full px-2.5 py-0.5 text-xs font-bold" :class="game.hasStats ? 'has-stats bg-[#d5e8d4] text-[#1f5a1a]' : 'no-stats bg-line text-inherit'">{{ game.hasStats ? t('sessions.withStats') : t('sessions.withoutStats') }}</span>
          <div class="schedule-match grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,1fr)] items-center gap-3">
            <ScheduleSide :team="game.homeTeam" :club="game.homeClub" :logo-url="game.homeLogoUrl" />
            <span class="schedule-center grid min-w-0 items-center justify-items-center gap-1 self-center text-center break-anywhere">
              <span v-if="game.venue" class="schedule-venue text-[0.9em] opacity-75">{{ game.venue }}</span>
              <span class="schedule-score inline-flex items-center gap-2 rounded-xl bg-line px-3.5 py-1 text-[2em] leading-[1.2]">
                <span :class="winnerSide(game) === 'home' ? 'is-winner font-extrabold' : 'is-loser'">{{ game.homeScore ?? '–' }}</span>
                –
                <span :class="winnerSide(game) === 'away' ? 'is-winner font-extrabold' : 'is-loser'">{{ game.awayScore ?? '–' }}</span>
              </span>
              <time class="schedule-time is-small text-[0.9em] leading-normal">{{ game.startTime }}</time>
            </span>
            <ScheduleSide :team="game.awayTeam" :club="game.awayClub" :logo-url="game.awayLogoUrl" />
          </div>
          <div v-if="sessionForGame(game)?.canReview && sessionForGame(game)?.status === 'in_review'" class="session-actions flex flex-wrap gap-2">
            <AppButton variant="primary" @click="finalizeSession(sessionForGame(game)!.id)">{{ t('sessions.finalise') }}</AppButton>
          </div>
        </article>
      </details>
    </AppCard>
    </template>
    <div v-if="!editing && showMine" class="session-actions my-teams-change mt-4 flex flex-wrap gap-2">
      <AppButton @click="startEditing">{{ t('sessions.changeMyTeams') }}</AppButton>
    </div>
    <ScorerRoleDialog
      v-if="roleGame"
      :home-name="roleGame.game.homeTeam"
      :away-name="roleGame.game.awayTeam"
      :busy="roleBusy"
      @view="chooseViewer"
      @scorer="chooseScorer"
      @cancel="roleGame = null"
    />
  </section>
</template>
