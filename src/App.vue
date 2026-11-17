<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import ActivityPanel from './components/ActivityPanel.vue'
import FoulMarker from './components/FoulMarker.vue'
import GameControls from './components/GameControls.vue'
import LineupDialog from './components/LineupDialog.vue'
import PlayerPickerDialog from './components/PlayerPickerDialog.vue'
import Scoreboard from './components/Scoreboard.vue'
import TeamSetupDialog from './components/TeamSetupDialog.vue'
import UserProfileDialog from './components/UserProfileDialog.vue'
import UpcomingGamesPage from './components/UpcomingGamesPage.vue'
import AdminDashboard from './components/AdminDashboard.vue'
import { errorMessage } from './domain/guards'
import { isPracticeGame, parseGameState, type GameAction, type GameState } from './domain/game'
import type { TeamProfile } from './services/teamProfiles'
import { loadUserProfile, saveUserProfile as persistUserProfile, type UserProfile } from './services/userProfile'
import { resetLocalData } from './services/resetLocalData'
import type { ZoebasMatch } from './services/zoebasMatches'
import { isAuthCallbackBlocked } from './services/supabaseClient'
import { loadSharedGame } from './services/sharedMatch'
import { isPlatformAdmin } from './services/admin'
import { useGameSession } from './composables/useGameSession'
import ThankYouOverlay from './components/ThankYouOverlay.vue'
import { useScreenWakeLock } from './composables/useScreenWakeLock'
import { useSupabaseConnection } from './composables/useSupabaseConnection'
import { isAppLocale, saveLocale, useLocale } from './i18n/useLocale'

const { t, locale, displayTeamName, displayPlayerName, formatPeriod } = useLocale()
const { connection } = useSupabaseConnection()
const connectionLabel = computed(() => t(connection.value === 'online'
  ? 'app.connectionOnline'
  : connection.value === 'offline' ? 'app.connectionOffline' : 'app.connectionChecking'))
const userProfile = ref<UserProfile | null>(null)
const userProfileOpen = ref(false)
const userProfileError = ref('')
const CoachLoginDialog = defineAsyncComponent(() => import('./components/CoachLoginDialog.vue'))
const LiveMatchPage = defineAsyncComponent(() => import('./components/LiveMatchPage.vue'))
const StatisticsPage = defineAsyncComponent(() => import('./components/StatisticsPage.vue'))
const PracticePage = defineAsyncComponent(() => import('./components/PracticePage.vue'))
const MatchViewerPage = defineAsyncComponent(() => import('./components/MatchViewerPage.vue'))
// The session a viewer is watching; a viewer never gets a local game.
const viewerMatchId = ref<string | null>(null)
const rosterEditing = ref(false)
const statisticsOpen = ref(false)
const practiceOpen = ref(false)
const platformAdmin = ref(false)
const adminOpen = ref(false)
watch(userProfileOpen, (open) => {
  if (!open) return
  void isPlatformAdmin().then((value) => { platformAdmin.value = value }).catch(() => { platformAdmin.value = false })
})
const coachLoginOpen = ref(false)
const homeOpen = ref(true)
const practiceSetup = ref(false)
const sharedInitialGame = ref<GameState | null>(null)
const sharedInitialError = ref('')
const onlineRefresh = ref(0)
const pageError = ref('')
const authCallbackBlocked = isAuthCallbackBlocked()
try {
  userProfile.value = loadUserProfile()
  userProfileOpen.value = userProfile.value === null
  if (userProfile.value) locale.value = userProfile.value.locale
} catch (error) {
  console.error('Failed to load user preferences.', error)
  userProfileError.value = t('errors.loadUserProfile')
  userProfileOpen.value = true
}

type Theme = 'light' | 'dark'

const themeStorageKey = 'watchtower-theme'

function loadTheme(): Theme {
  try {
    return window.localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light'
  } catch (error) {
    console.error('Failed to load saved theme.', error)
    return 'light'
  }
}

const theme = ref<Theme>(loadTheme())
let savedTheme = theme.value

function applyTheme() {
  document.documentElement.dataset.theme = theme.value
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme.value === 'dark' ? '#17191f' : '#f7f6f3',
  )
}

applyTheme()

function previewTheme(value: Theme) {
  theme.value = value
  applyTheme()
}

const {
  game,
  selectedTeamId,
  selectedTeam,
  teamPlayers,
  pickerPlayers,
  canStart,
  canStartNewMatch,
  scores,
  scoreNotification,
  teamStats,
  playerFouls,
  periodTeamFouls,
  clockDisplay,
  recentActions,
  pendingAction,
  pendingScorerId,
  pendingAssistId,
  pendingReboundId,
  pendingFlow,
  pendingFlowIndex,
  pendingShotLocation,
  pendingFoulType,
  pendingTurnoverType,
  editingActionId,
  lineupEditorOpen,
  startingPeriod,
  draftCourtPlayerIds,
  lineupError,
  storageError,
  matchLink,
  matchSyncStatus,
  matchSyncError,
  matchSyncConfigured,
  teamProfiles,
  rosterEditProfile,
  selectedTeamProfileIds,
  teamSetupOpen,
  teamSetupInitializing,
  canCancelTeamSetup,
  teamCatalog,
  teamCatalogLoading,
  teamCatalogError,
  teamCatalogCached,
  playerName,
  addAction,
  addOpponentScore,
  removeOpponentScore,
  selectPlayer,
  selectAssist,
  selectRebound,
  chooseFoulType,
  chooseTurnoverType,
  goToFlowStep,
  commitPendingAction,
  cancelPendingAction,
  editAction,
  undoLastAction,
  toggleGame,
  toggleClock,
  applyTeamSetup,
  saveGameRoster,
  openTeamSetup,
  cancelTeamSetup,
  openLineupEditor,
  beginPeriod,
  toggleDraftCourtPlayer,
  saveLineup,
  cancelLineupEdit,
  markMatchFinished,
  finishLocalMatch,
  releaseFinishedMatch,
  joinSharedMatch,
} = useGameSession()
const hasCurrentGame = computed(() => {
  if (matchLink.value) return !matchLink.value.finished
  return !game.localFinishedAt && (game.period !== undefined || game.actions.length > 0)
})
// A running practice game only exists on this device, so the landing page gets it from the local session.
const openPracticeGame = computed(() => {
  if (!hasCurrentGame.value || matchLink.value || !isPracticeGame(game)) return null
  return {
    homeTeam: game.teams[0].name,
    awayTeam: game.teams[1].name,
    awayClub: game.teams[1].club ?? null,
    homeScore: scores.value[0]?.points ?? 0,
    awayScore: scores.value[1]?.points ?? 0,
    startTime: game.matchInfo?.startTime ?? '',
  }
})
watch([() => matchLink.value?.matchId, onlineRefresh], async ([id], old, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  if (id !== old?.[0]) sharedInitialGame.value = null
  if (!id) { sharedInitialGame.value = null; sharedInitialError.value = ''; return }
  try {
    const data = await loadSharedGame(id)
    if (!cancelled) { sharedInitialGame.value = parseGameState(data); sharedInitialError.value = '' }
  } catch (error) {
    if (!cancelled) {
      console.error('Failed to load the live match.', error)
      sharedInitialError.value = errorMessage(error)
    }
  }
}, { immediate: true })
function refreshOnlineData() { onlineRefresh.value++ }
onMounted(() => window.addEventListener('online', refreshOnlineData))
onUnmounted(() => window.removeEventListener('online', refreshOnlineData))
const wakeLockStatus = useScreenWakeLock(computed(() =>
  game.gameStarted && (userProfile.value?.keepScreenAwake ?? true),
))
const updateAvailable = ref(false)
const offlineSetupError = ref(false)
const updateBlocked = computed(() => game.gameStarted && game.clock?.deadline != null)
let updateActivated = false
let updateRequested = false
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined

onMounted(() => {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) {
    console.error('Service workers are unavailable; offline startup cannot be prepared.')
    offlineSetupError.value = true
    return
  }
  updateServiceWorker = registerSW({
    onNeedRefresh() { updateAvailable.value = true },
    onNeedReload() {
      updateActivated = true
      if (updateRequested && !updateBlocked.value) window.location.reload()
      else updateAvailable.value = true
    },
    onOfflineReady() { offlineSetupError.value = false },
    onRegisterError(error) {
      console.error('Failed to register the offline app.', error)
      offlineSetupError.value = true
    },
    onRegisteredSW(_url, registration) {
      const installing = registration?.installing
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'redundant' && !registration?.active) {
          console.error('Failed to install the offline app.')
          offlineSetupError.value = true
        }
      })
    },
  })
})

async function updateApp() {
  if (updateBlocked.value || !updateServiceWorker) return
  try {
    if (updateActivated) {
      window.location.reload()
      return
    }
    updateRequested = true
    await updateServiceWorker(true)
  } catch (error) {
    updateRequested = false
    console.error('Failed to update the offline app.', error)
    offlineSetupError.value = true
  }
}
const homeCourtPlayers = computed(() => game.players.filter((player) =>
  player.teamId === game.teams[0].id && player.isOnCourt,
))
const nextPeriodLabel = computed(() => {
  const period = (game.period ?? 1) + 1
  return formatPeriod(period, game.youth ?? false, true)
})

async function joinSession(id: string, side: 'home' | 'away' = 'home') {
  if (!userProfile.value) return
  pageError.value = ''
  try {
    if (!hasCurrentGame.value) {
      if (await joinSharedMatch(id, userProfile.value.name, side)) {
        homeOpen.value = false
        if (!game.gameStarted && !teamPlayers.value.length) openRosterEditor()
      } else pageError.value = matchSyncError.value
    }
  } catch (error) {
    console.error('Failed to join session.', error)
    pageError.value = errorMessage(error)
  }
}

function finishCurrentMatch() {
  if (matchLink.value) statisticsOpen.value = true
  else if (window.confirm(t('sessions.finishLocalConfirm')) && finishLocalMatch()) showThankYou(true)
}

// The thank-you screen covers the page the scorer finished on and ends on the games overview.
const thankYou = ref<{ teams: { id: string; name: string; points: number }[]; practice: boolean } | null>(null)

function showThankYou(practice: boolean) {
  thankYou.value = {
    teams: game.teams.map((team, index) => ({ id: team.id, name: team.name, points: scores.value[index]?.points ?? 0 })),
    practice,
  }
}

function closeThankYou() {
  const practice = thankYou.value?.practice ?? false
  thankYou.value = null
  statisticsOpen.value = false
  homeOpen.value = true
  practiceOpen.value = practice
}

function updateTeamName(teamId: string, name: string) {
  const team = game.teams.find((item) => item.id === teamId)
  if (team) team.name = name
}

function handleEditAction(action: GameAction) {
  editAction(action)
}

async function saveTeamSetup(
  profiles: TeamProfile[],
  profileIds: [string, string],
  match: ZoebasMatch | null,
  manualOpponentName: string,
  manualStart: string,
  opponentClub: string,
) {
  if (!applyTeamSetup(profiles, profileIds, match, manualOpponentName, manualStart, practiceSetup.value, opponentClub)) return
  practiceSetup.value = false
}

function openStatistics() {
  practiceOpen.value = false
  statisticsOpen.value = true
}

function openPracticePage() {
  statisticsOpen.value = false
  practiceOpen.value = true
}

function startPractice() {
  practiceOpen.value = false
  if (hasCurrentGame.value) return
  pageError.value = ''
  practiceSetup.value = true
  openTeamSetup()
  homeOpen.value = false
}

function cancelSetup() {
  if (!practiceSetup.value) {
    cancelTeamSetup()
    return
  }
  practiceSetup.value = false
  cancelTeamSetup(true)
  homeOpen.value = true
}

watch(homeOpen, (open) => {
  if (open && practiceSetup.value) {
    practiceSetup.value = false
    cancelTeamSetup(true)
  }
})

function openRosterEditor() {
  if (game.clock?.deadline != null) toggleClock()
  rosterEditing.value = true
  window.scrollTo(0, 0)
}

function saveRoster(profile: TeamProfile) {
  if (saveGameRoster(profile)) rosterEditing.value = false
}

function saveUserPreferences(profile: UserProfile) {
  try {
    saveLocale(profile.locale)
    persistUserProfile(profile)
    window.localStorage.setItem(themeStorageKey, theme.value)
    savedTheme = theme.value
    userProfile.value = profile
    locale.value = profile.locale
    userProfileOpen.value = false
    userProfileError.value = ''
  } catch (error) {
    console.error('Failed to save user preferences.', error)
    userProfileError.value = t('errors.saveUserProfile')
  }
}

function previewProfileLocale(value: UserProfile['locale']) {
  locale.value = value
}

function cancelUserProfileEdit() {
  userProfileOpen.value = false
  if (userProfile.value) locale.value = userProfile.value.locale
  previewTheme(savedTheme)
}

function resetApp() {
  if (!window.confirm(t('userProfile.resetConfirm'))) return
  try {
    resetLocalData(window.localStorage)
    resetLocalData(window.sessionStorage)
    window.location.reload()
  } catch (error) {
    console.error('Failed to reset local app data.', error)
    userProfileError.value = t('userProfile.resetError')
  }
}

watch(locale, (value) => {
  const activeLocale = isAppLocale(value) ? value : 'nl'
  document.documentElement.lang = activeLocale
  document.title = t('app.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.metaDescription'))
}, { immediate: true })
</script>

<template>
  <main class="app-shell" :class="{ 'game-live': game.gameStarted }">
    <header class="topbar">
      <a class="brand" href="#" :aria-label="t('app.brandHome')" @click.prevent="homeOpen = true; practiceOpen = false; viewerMatchId = null">
        <span class="brand-mark">W</span>
        <span>watchtower<span class="brand-dot">.</span></span>
      </a>
      <div class="topbar-right">
        <button class="share-match-button" type="button" :aria-label="t('sessions.practiceMenu')" :title="t('sessions.practiceMenu')" @click="openPracticePage">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6v3H9zM7 5.5H5v15h14v-15h-2M12 10.5v6M9 13.5h6" /></svg>
        </button>
        <button class="share-match-button" type="button" :aria-label="t('statistics.title')" :title="t('statistics.title')" @click="openStatistics">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V12h4v8M10 20V5h4v15M16 20V9h4v11M2 20h20" /></svg>
        </button>
        <span v-if="!teamSetupOpen && !homeOpen" class="offline-indicator">
          <span :class="matchLink || matchSyncStatus !== 'local' ? `sync-dot-${matchSyncStatus}` : ''"></span>
          {{ matchLink || matchSyncStatus !== 'local' ? t(`sync.status.${matchSyncStatus}`) : t('app.savedLocally') }}
        </span>
        <button class="avatar" type="button" :aria-label="userProfile?.name ? `${t('app.profile')}: ${userProfile.name}` : t('app.profile')" :title="t('app.profile')" @click="userProfileOpen = true">          {{ userProfile?.name.trim().charAt(0).toLocaleUpperCase() || '?' }}
        </button>
      </div>
    </header>

    <div v-if="storageError" class="notice" role="alert">{{ storageError }}</div>
    <div v-if="pageError" class="notice" role="alert">{{ pageError }}</div>
    <div v-if="sharedInitialError" class="notice" role="alert">{{ sharedInitialError }}</div>
    <div v-if="authCallbackBlocked" class="notice" role="alert">{{ t('statistics.authCallbackBlocked') }}</div>
    <div v-if="!matchLink && matchSyncError" class="notice" role="alert">{{ matchSyncError }}</div>
    <div v-if="offlineSetupError" class="notice" role="alert">{{ t('userProfile.offlineSetupError') }}</div>
    <div v-if="wakeLockStatus === 'unsupported' || wakeLockStatus === 'error'" class="notice" role="status">
      {{ t(wakeLockStatus === 'unsupported' ? 'userProfile.screenWakeUnsupported' : 'userProfile.screenWakeError') }}
    </div>
    <div v-if="updateAvailable" class="notice" role="status">
      {{ t('userProfile.updateAvailable') }}
      <span v-if="updateBlocked">{{ t('userProfile.updateAfterGame') }}</span>
      <button v-else type="button" class="text-button" @click="updateApp">{{ t('userProfile.updateNow') }}</button>
    </div>
    <UserProfileDialog
      v-if="userProfileOpen"
      :profile="userProfile"
      :teams="teamCatalog"
      :error="userProfileError"
      :theme="theme"
      @cancel="cancelUserProfileEdit"
      @save="saveUserPreferences"
      @locale-change="previewProfileLocale"
      @theme-change="previewTheme"
      @reset="resetApp"
      :is-admin="platformAdmin"
      @coach-login="coachLoginOpen = true"
      @admin="userProfileOpen = false; adminOpen = true"
    />

    <AdminDashboard v-if="adminOpen" @close="adminOpen = false" />

    <CoachLoginDialog
      v-if="coachLoginOpen"
      :has-match="!!matchLink"
      :release-match="releaseFinishedMatch"
      @close="coachLoginOpen = false"
    />

    <StatisticsPage
      v-if="statisticsOpen && !userProfileOpen && !coachLoginOpen"
      :match-link="matchLink"
      :sync-status="matchSyncStatus"
      :current-team-id="game.catalogTeamId"
      @close="statisticsOpen = false"
      @coach-login="coachLoginOpen = true"
      @finished="markMatchFinished"
      @match-completed="showThankYou(false)"
    />


    <PracticePage
      v-else-if="practiceOpen && userProfile && !userProfileOpen && !coachLoginOpen"
      :configured="matchSyncConfigured"
      :has-current-game="hasCurrentGame"
      :display-name="userProfile.name"
      @close="practiceOpen = false"
      @start="startPractice"
    />

    <MatchViewerPage
      v-else-if="viewerMatchId && userProfile && !userProfileOpen && !coachLoginOpen"
      :key="viewerMatchId"
      :match-id="viewerMatchId"
      @close="viewerMatchId = null"
    />

    <UpcomingGamesPage
      v-else-if="homeOpen && userProfile && !userProfileOpen && !coachLoginOpen"
      :configured="matchSyncConfigured"
      :has-current-game="hasCurrentGame"
      :practice-game="openPracticeGame"
      :display-name="userProfile.name"
      :current-match-id="matchLink?.matchId ?? null"
      @resume="homeOpen = false"
      @join="joinSession"
      @view="viewerMatchId = $event"
    />

    <TeamSetupDialog
      v-else-if="userProfile && teamSetupOpen && !teamSetupInitializing && !statisticsOpen"
      :profiles="teamProfiles"
      :selected-profile-ids="selectedTeamProfileIds"
      :catalog-teams="teamCatalog"
      :catalog-loading="teamCatalogLoading"
      :catalog-error="teamCatalogError"
      :catalog-cached="teamCatalogCached"
      :local-only="!practiceSetup"
      :practice="practiceSetup"
      :can-cancel="practiceSetup || canCancelTeamSetup"
      :error="storageError"
      home
      @cancel="cancelSetup"
      @save="saveTeamSetup"
    />

    <div v-else-if="teamSetupInitializing" class="team-setup-loading panel" role="status">
      {{ t('teamSetup.preparing') }}
    </div>

    <TeamSetupDialog
      v-else-if="rosterEditing && rosterEditProfile && !userProfileOpen"
      :profiles="teamProfiles"
      :selected-profile-ids="selectedTeamProfileIds"
      :catalog-teams="teamCatalog"
      :catalog-loading="teamCatalogLoading"
      :catalog-error="teamCatalogError"
      :roster-profile="rosterEditProfile"
      :require-on-court="(game.period ?? 0) > 0"
      :error="storageError"
      can-cancel
      home
      @cancel="rosterEditing = false"
      @save-roster="saveRoster"
    />

    <template v-else-if="!userProfileOpen && !statisticsOpen">
      <p v-if="matchLink" class="statistics-hint">{{ t('sessions.localScoreNotice') }}</p>
      <div class="game-header" :class="{ 'game-header-sticky': game.gameStarted || (game.period !== undefined && game.period > 0) }">
      <Scoreboard
        :teams="game.teams"
        :scores="scores"
        :score-notification="scoreNotification"
        :game-started="game.gameStarted"
        :match-finished="(matchLink?.finished ?? false) || !!game.localFinishedAt"
        :can-finish-match="(game.period ?? 0) > 0 || game.actions.length > 0"
        :can-start="canStart"
        :can-start-new-match="canStartNewMatch"
        :period="game.period"
        :youth="game.youth ?? false"
        :clock-display="clockDisplay"
        :clock-phase="game.clock?.phase"
        :clock-running="game.clock?.deadline != null"
        :clock-available="!!game.clock"
        :team-fouls="periodTeamFouls"
        @team-name-change="updateTeamName"
        @toggle-game="toggleGame"
        @new-match="homeOpen = true"
        @next-period="beginPeriod"
        @toggle-clock="toggleClock"
        @finish-match="finishCurrentMatch"
      />
      <section v-if="game.gameStarted || (game.period !== undefined && game.period > 0)" class="court-lineup panel" :aria-label="t('picker.fieldPlayers')">
        <ul class="court-lineup-players" tabindex="0">
          <li v-for="player in homeCourtPlayers" :key="player.id">
            <span class="court-lineup-number">{{ player.jerseyNumber || '—' }}</span>
            <span>{{ displayPlayerName(player.name) }}</span>
            <FoulMarker :count="playerFouls[player.id] ?? 0" />
          </li>
        </ul>
        <button class="lineup-change-button" type="button" :aria-label="t('controls.substitutions')" :title="t('controls.substitutions')" @click="openLineupEditor"><span aria-hidden="true">⇄</span></button>
      </section>
      </div>

    <div class="content-grid">
      <GameControls
        v-if="!game.localFinishedAt"
        :team-id="selectedTeamId"
        :team-players="teamPlayers"
        :game-started="game.gameStarted || !!matchLink?.finished"
        :can-start="canStart"
        :awaiting-first-period="game.period === 0"
        @edit-roster="openRosterEditor"
        @edit-lineup="openLineupEditor"
        @add-action="addAction"
        @opponent-score="addOpponentScore"
      />
      <ActivityPanel
        :teams="game.teams"
        :recent-actions="recentActions"
        :timeline="game.timeline ?? []"
        :youth="game.youth ?? false"
        :team-stats="teamStats"
        :player-name="playerName"
        :can-undo="game.actions.length > 0"
        :player-fouls="playerFouls"
        :read-only="!!game.localFinishedAt"
        @edit-action="handleEditAction"
        @remove-opponent-score="removeOpponentScore"
        @undo="undoLastAction"
      />
      <LiveMatchPage
        v-if="matchLink && sharedInitialGame"
        :key="matchLink.matchId"
        :match-id="matchLink.matchId"
        :initial-game="sharedInitialGame"
        embedded
      />
    </div>

    <PlayerPickerDialog
      v-if="pendingAction"
      :action="pendingAction"
      :flow="pendingFlow"
      :step-index="pendingFlowIndex"
      :team-name="displayTeamName(selectedTeam)"
      :players="pickerPlayers"
      :scorer-id="pendingScorerId"
      :assist-player-id="pendingAssistId"
      :rebound-id="pendingReboundId"
      :editing="editingActionId !== null"
      :foul-type="pendingFoulType"
      :turnover-type="pendingTurnoverType"
      :shot-location="pendingShotLocation"
      :player-fouls="playerFouls"
      @cancel="cancelPendingAction"
      @go-to-step="goToFlowStep"
      @select-player="selectPlayer"
      @select-assist="selectAssist"
      @select-rebound="selectRebound"
      @update:shot-location="pendingShotLocation = $event"
      @select-foul-type="chooseFoulType"
      @select-turnover-type="chooseTurnoverType"
      @finish="commitPendingAction"
    />
    <LineupDialog
      v-if="lineupEditorOpen"
      :team-name="displayTeamName(selectedTeam)"
      :players="teamPlayers"
      :selected-player-ids="draftCourtPlayerIds"
      :period-label="startingPeriod ? nextPeriodLabel : undefined"
      :error="lineupError"
      :player-fouls="playerFouls"
      @cancel="cancelLineupEdit"
      @save="saveLineup"
      @toggle="toggleDraftCourtPlayer"
    />
    </template>

    <footer class="app-footer">
      <div class="footer-copy"><span class="footer-ball">◉</span> {{ t('app.footer') }} <span>·</span> Watchtower</div>
      <button
        v-if="game.gameStarted && !teamSetupOpen && !userProfileOpen && !rosterEditing && !statisticsOpen"
        class="new-match-button"
        type="button"
        :disabled="!rosterEditProfile"
        :title="t('scoreboard.editPlayersHint')"
        @click="openRosterEditor"
      >{{ t('scoreboard.editPlayers') }}</button>
      <span class="connection-status" :class="`is-${connection}`" role="status" :aria-label="connectionLabel" :title="connectionLabel"></span>
    </footer>

    <ThankYouOverlay v-if="thankYou" :teams="thankYou.teams" @done="closeThankYou" />
  </main>
</template>
