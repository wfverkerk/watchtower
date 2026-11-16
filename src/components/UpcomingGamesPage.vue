<script setup lang="ts">
import PageHeader from './PageHeader.vue'
import ScorerRoleDialog from './ScorerRoleDialog.vue'
import ScheduleSide from './ScheduleSide.vue'
import { errorMessage } from '../domain/guards'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { gameStartMs, groupByDay, groupTeams, localDateKey, scheduleBucket, teamGroupLabelKeys, winnerSide, type ScheduleGame } from '../domain/schedule'
import { sessionPhase } from '../domain/sessionWindow'
import { createInitialGameState, type GameState } from '../domain/game'
import { useFavoriteTeams } from '../composables/useFavoriteTeams'
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
}>()
const { t, locale } = useLocale()
const allSessions = ref<MatchSession[]>([])
// The game whose role is being chosen. Without a session nobody has started it yet, so there is nothing to watch.
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
    teams: [
      { id: 'home', name: game.homeTeam, color: '#f26a36' },
      { id: 'away', name: game.awayTeam, color: '#5d72d9' },
    ],
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

function chooseViewer() {
  const target = roleGame.value
  roleGame.value = null
  if (target?.sessionId) emit('view', target.sessionId)
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
  <section class="sessions-page">
    <PageHeader :eyebrow="t('sessions.eyebrow')" :title="t('sessions.title')">
      <div class="landing-toggle" role="group" :aria-label="t('sessions.myTeams')">
        <button type="button" :class="{ 'is-active': mode === 'mine' }" :aria-pressed="mode === 'mine' ? 'true' : 'false'" @click="selectMine">{{ t('sessions.myTeams') }}</button>
        <button type="button" :class="{ 'is-active': mode === 'all' }" :aria-pressed="mode === 'all' ? 'true' : 'false'" @click="selectAll">{{ t('sessions.allTeams') }}</button>
      </div>
    </PageHeader>
    <p v-if="!configured" class="notice">{{ t('sync.notConfigured') }}</p>
    <p v-if="error" class="notice" role="alert">{{ t('sessions.loadError') }}: {{ error }}</p>
    <p v-if="checking" class="statistics-hint" role="status">{{ t('roles.checking') }}</p>
    <p v-if="scheduleError" class="notice" role="alert">{{ t('sessions.scheduleError') }}: {{ scheduleError }}</p>
    <section v-if="editing" class="panel statistics-card my-teams-editor">
      <h2>{{ t('sessions.pickMyTeams') }}</h2>
      <p class="statistics-hint">{{ t('sessions.myTeamsHint') }}</p>
      <div v-for="section in teamSections" :key="section.group" class="favorite-team-section">
        <h3>{{ t(teamGroupLabelKeys[section.group]) }}</h3>
        <div class="favorite-team-grid">
          <button
            v-for="name in section.teams"
            :key="name"
            type="button"
            class="favorite-team-tile"
            :class="{ 'is-favorite': draftFavorites.includes(name) }"
            :aria-pressed="draftFavorites.includes(name) ? 'true' : 'false'"
            :aria-label="name"
            @click="toggleDraft(name)"
          >
            <span>{{ name }}</span>
            <span class="favorite-tile-heart" aria-hidden="true">♥</span>
          </button>
        </div>
      </div>
      <div class="session-actions">
        <button type="button" class="match-sync-primary" @click="saveMyTeams">{{ t('sessions.saveMyTeams') }}</button>
      </div>
    </section>
    <template v-if="!editing">
    <section class="panel statistics-card">
      <p v-if="!openGames.length && !practiceGame" class="statistics-hint">{{ t('sessions.openEmpty') }}</p>
      <article v-if="practiceGame" class="session-row schedule-game is-live practice-open-game">
        <button type="button" class="schedule-open-trigger" @click="emit('resume')">
          <span class="schedule-match">
            <ScheduleSide :team="practiceGame.homeTeam" :club="zoebasClubName" />
            <span class="schedule-center">
              <span class="schedule-venue">{{ t('sessions.practiceBadge') }}</span>
              <span class="schedule-score is-live">
                <span>{{ practiceGame.homeScore }} – {{ practiceGame.awayScore }}</span>
                <span class="live-score-label">{{ statusLabel('live') }}</span>
              </span>
              <time class="schedule-time is-small">{{ practiceGame.startTime }}</time>
            </span>
            <ScheduleSide :team="practiceGame.awayTeam" :club="practiceGame.awayClub" />
          </span>
        </button>
      </article>
      <article v-for="game in openGames" :key="game.id" class="session-row schedule-game" :class="{ 'is-live': sessionForGame(game)?.status === 'live' }">
        <button type="button" class="schedule-open-trigger" :disabled="!canPick(game)" @click="tapGame(game)">
          <span class="schedule-match">
            <ScheduleSide :team="game.homeTeam" :club="game.homeClub" :logo-url="game.homeLogoUrl" />
            <span v-if="isLiveGame(game)" class="schedule-center">
              <span v-if="game.venue" class="schedule-venue">{{ game.venue }}</span>
              <span class="schedule-score is-live">
                <span>{{ sessionForGame(game)?.homeScore ?? 0 }} – {{ sessionForGame(game)?.awayScore ?? 0 }}</span>
                <span class="live-score-label">{{ statusLabel('live') }}</span>
              </span>
              <time class="schedule-time is-small">{{ game.startTime }}</time>
            </span>
            <span v-else class="schedule-center">
              <span v-if="game.venue" class="schedule-venue">{{ game.venue }}</span>
              <time class="schedule-time">{{ game.startTime }}</time>
            </span>
            <ScheduleSide :team="game.awayTeam" :club="game.awayClub" :logo-url="game.awayLogoUrl" />
          </span>
        </button>
        <span v-if="sessionForGame(game) && !isLiveGame(game)" class="session-status" :data-status="sessionForGame(game)!.status">{{ statusLabel(sessionForGame(game)!.status) }}</span>
        <span v-else-if="!sessionForGame(game) && !canPick(game)" class="statistics-hint">{{ t('sessions.opensBefore') }}</span>
        <div v-if="sessionForGame(game)?.canReview && sessionForGame(game)?.status === 'in_review'" class="session-actions">
          <button type="button" class="match-sync-primary" @click="finalizeSession(sessionForGame(game)!.id)">{{ t('sessions.finalise') }}</button>
        </div>
      </article>
    </section>
    <section class="panel statistics-card">
      <h2>{{ t('sessions.upcomingTitle') }}</h2>
      <p v-if="!upcomingDays.length" class="statistics-hint">{{ t('sessions.upcomingEmpty') }}</p>
      <details v-for="(day, index) in upcomingDays" :key="day.date" class="history-day" :open="isExpandedDay(day.date, index)">
        <summary class="schedule-day-summary">{{ formatDay(day.date) }} <small>{{ day.games.length }}</small></summary>
        <article v-for="game in day.games" :key="game.id" class="session-row schedule-game">
          <div class="schedule-match">
            <ScheduleSide :team="game.homeTeam" :club="game.homeClub" :logo-url="game.homeLogoUrl" />
            <span class="schedule-center">
              <span v-if="game.venue" class="schedule-venue">{{ game.venue }}</span>
              <time class="schedule-time">{{ game.startTime }}</time>
            </span>
            <ScheduleSide :team="game.awayTeam" :club="game.awayClub" :logo-url="game.awayLogoUrl" />
          </div>
        </article>
      </details>
    </section>
    <section class="panel statistics-card">
      <h2>{{ t('sessions.historyTitle') }}</h2>
      <p v-if="!historyGames.length" class="statistics-hint">{{ t('sessions.historyEmpty') }}</p>
      <details v-for="day in historyDays" :key="day.date" class="history-day">
        <summary>{{ formatDay(day.date) }} <small>{{ day.games.length }}</small></summary>
        <article v-for="game in day.games" :key="game.id" class="session-row schedule-game">
          <span class="stats-label" :class="game.hasStats ? 'has-stats' : 'no-stats'">{{ game.hasStats ? t('sessions.withStats') : t('sessions.withoutStats') }}</span>
          <div class="schedule-match">
            <ScheduleSide :team="game.homeTeam" :club="game.homeClub" :logo-url="game.homeLogoUrl" />
            <span class="schedule-center">
              <span v-if="game.venue" class="schedule-venue">{{ game.venue }}</span>
              <span class="schedule-score">
                <span :class="winnerSide(game) === 'home' ? 'is-winner' : 'is-loser'">{{ game.homeScore ?? '–' }}</span>
                –
                <span :class="winnerSide(game) === 'away' ? 'is-winner' : 'is-loser'">{{ game.awayScore ?? '–' }}</span>
              </span>
              <time class="schedule-time is-small">{{ game.startTime }}</time>
            </span>
            <ScheduleSide :team="game.awayTeam" :club="game.awayClub" :logo-url="game.awayLogoUrl" />
          </div>
          <div v-if="sessionForGame(game)?.canReview && sessionForGame(game)?.status === 'in_review'" class="session-actions">
            <button type="button" class="match-sync-primary" @click="finalizeSession(sessionForGame(game)!.id)">{{ t('sessions.finalise') }}</button>
          </div>
        </article>
      </details>
    </section>
    </template>
    <div v-if="!editing && showMine" class="session-actions my-teams-change">
      <button type="button" class="match-sync-secondary" @click="startEditing">{{ t('sessions.changeMyTeams') }}</button>
    </div>
    <ScorerRoleDialog
      v-if="roleGame"
      :home-name="roleGame.game.homeTeam"
      :away-name="roleGame.game.awayTeam"
      :can-watch="!!roleGame.sessionId"
      :busy="roleBusy"
      @view="chooseViewer"
      @scorer="chooseScorer"
      @cancel="roleGame = null"
    />
  </section>
</template>
