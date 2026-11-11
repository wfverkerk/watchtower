<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ActivityPanel from './components/ActivityPanel.vue'
import FoulMarker from './components/FoulMarker.vue'
import GameControls from './components/GameControls.vue'
import LineupDialog from './components/LineupDialog.vue'
import MatchSyncDialog from './components/MatchSyncDialog.vue'
import PlayerPickerDialog from './components/PlayerPickerDialog.vue'
import Scoreboard from './components/Scoreboard.vue'
import TeamSetupDialog from './components/TeamSetupDialog.vue'
import UserProfileDialog from './components/UserProfileDialog.vue'
import type { GameAction } from './domain/game'
import { regulationPeriods } from './domain/gameClock'
import type { TeamProfile } from './services/teamProfiles'
import { loadUserProfile, saveUserProfile as persistUserProfile, type UserProfile } from './services/userProfile'
import { resetLocalData } from './services/resetLocalData'
import type { ZoebasMatch } from './services/zoebasMatches'
import { useGameSession } from './composables/useGameSession'
import { isAppLocale, saveLocale, useLocale } from './i18n/useLocale'

const { t, locale, displayTeamName, displayPlayerName } = useLocale()
const matchSyncOpen = ref(false)
const userProfile = ref<UserProfile | null>(null)
const userProfileOpen = ref(false)
const userProfileError = ref('')
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
  selectedPlayerId,
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
  pendingShotLocation,
  pendingFoulType,
  pendingTurnoverType,
  editingActionId,
  lineupEditorOpen,
  startingPeriod,
  draftCourtPlayerIds,
  newPlayerName,
  newPlayerNumber,
  playerFormError,
  lineupError,
  editingPlayerId,
  storageError,
  matchLink,
  matchSyncStatus,
  matchSyncError,
  matchSyncConfigured,
  teamProfiles,
  selectedTeamProfileIds,
  teamSetupOpen,
  teamSetupInitializing,
  canCancelTeamSetup,
  teamCatalog,
  teamCatalogLoading,
  teamCatalogError,
  playerName,
  addAction,
  addOpponentScore,
  removeOpponentScore,
  selectPlayer,
  selectScorer,
  finishShotAction,
  finishFoulAction,
  finishTurnoverAction,
  cancelPendingAction,
  editAction,
  undoLastAction,
  toggleGame,
  toggleClock,
  applyTeamSetup,
  openTeamSetup,
  cancelTeamSetup,
  savePlayer,
  editPlayer,
  cancelPlayerEdit,
  removePlayer,
  togglePregamePlayer,
  playerHasActions,
  openLineupEditor,
  beginPeriod,
  toggleDraftCourtPlayer,
  saveLineup,
  cancelLineupEdit,
  createSharedMatch,
  joinSharedMatch,
} = useGameSession()
const homeCourtPlayers = computed(() => game.players.filter((player) =>
  player.teamId === game.teams[0].id && player.isOnCourt && !player.isCoach,
))
const nextPeriodLabel = computed(() => {
  const period = (game.period ?? 1) + 1
  const limit = regulationPeriods(game.youth ?? false)
  return period > limit
    ? t('scoreboard.overtime', { count: period - limit })
    : t(game.youth ? 'scoreboard.period' : 'lineup.quarter', { count: period })
})

async function createMatch(displayName: string) {
  if (await createSharedMatch(displayName)) matchSyncOpen.value = false
}

async function joinMatch(joinCode: string, displayName: string) {
  if (await joinSharedMatch(joinCode, displayName)) matchSyncOpen.value = false
}

function updateTeamName(teamId: string, name: string) {
  const team = game.teams.find((item) => item.id === teamId)
  if (team) team.name = name
}

function handleEditAction(action: GameAction) {
  editAction(action)
}

function saveTeamSetup(
  profiles: TeamProfile[],
  profileIds: [string, string],
  match: ZoebasMatch | null,
  manualOpponentName: string,
) {
  applyTeamSetup(profiles, profileIds, match, manualOpponentName)
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
      <a class="brand" href="#" :aria-label="t('app.brandHome')">
        <span class="brand-mark">W</span>
        <span>watchtower<span class="brand-dot">.</span></span>
      </a>
      <div class="topbar-right">
        <span v-if="!teamSetupOpen" class="offline-indicator">
          <span :class="matchLink ? `sync-dot-${matchSyncStatus}` : ''"></span>
          {{ matchLink ? t(`sync.status.${matchSyncStatus}`) : t('app.savedLocally') }}
        </span>
        <button v-if="!teamSetupOpen" class="share-match-button" type="button" :aria-label="t('sync.open')" :title="t('sync.open')" @click="matchSyncOpen = true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4" />
          </svg>
        </button>
        <button class="avatar" type="button" :aria-label="userProfile?.name ? `${t('app.profile')}: ${userProfile.name}` : t('app.profile')" :title="t('app.profile')" @click="userProfileOpen = true">
          {{ userProfile?.name.trim().charAt(0).toLocaleUpperCase() || '?' }}
        </button>
      </div>
    </header>

    <div v-if="storageError" class="notice" role="alert">{{ storageError }}</div>
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
    />

    <TeamSetupDialog
      v-if="userProfile && teamSetupOpen && !teamSetupInitializing"
      :profiles="teamProfiles"
      :selected-profile-ids="selectedTeamProfileIds"
      :catalog-teams="teamCatalog"
      :catalog-loading="teamCatalogLoading"
      :catalog-error="teamCatalogError"
      :can-cancel="canCancelTeamSetup"
      :error="storageError"
      home
      @cancel="cancelTeamSetup"
      @save="saveTeamSetup"
    />

    <div v-else-if="teamSetupInitializing" class="team-setup-loading panel" role="status">
      {{ t('teamSetup.preparing') }}
    </div>

    <template v-else-if="!userProfileOpen">
      <div class="game-header" :class="{ 'game-header-sticky': game.gameStarted || (game.period !== undefined && game.period > 0) }">
      <Scoreboard
        :teams="game.teams"
        :scores="scores"
        :score-notification="scoreNotification"
        :game-started="game.gameStarted"
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
        @new-match="openTeamSetup"
        @next-period="beginPeriod"
        @toggle-clock="toggleClock"
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
        :team-id="selectedTeamId"
        v-model:selected-player-id="selectedPlayerId"
        v-model:new-player-name="newPlayerName"
        v-model:new-player-number="newPlayerNumber"
        :team-players="teamPlayers"
        :game-started="game.gameStarted"
        :can-start="canStart"
        :awaiting-first-period="game.period === 0"
        :editing-player-id="editingPlayerId"
        :player-form-error="playerFormError"
        :lineup-error="lineupError"
        :player-has-actions="playerHasActions"
        :player-fouls="playerFouls"
        @save-player="savePlayer"
        @edit-player="editPlayer"
        @cancel-player-edit="cancelPlayerEdit"
        @remove-player="removePlayer"
        @toggle-pregame-player="togglePregamePlayer"
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
        :player-is-coach="(id) => !!game.players.find((player) => player.id === id)?.isCoach"
        @edit-action="handleEditAction"
        @remove-opponent-score="removeOpponentScore"
        @undo="undoLastAction"
      />
    </div>

    <PlayerPickerDialog
      v-if="pendingAction"
      v-model:assist-player-id="pendingAssistId"
      v-model:shot-location="pendingShotLocation"
      :action="pendingAction"
      :team-name="displayTeamName(selectedTeam)"
      :players="pickerPlayers"
      :scorer-id="pendingScorerId"
      :editing="editingActionId !== null"
      :foul-type="pendingFoulType"
      :turnover-type="pendingTurnoverType"
      :player-fouls="playerFouls"
      @cancel="cancelPendingAction"
      @select-player="selectPlayer"
      @select-scorer="selectScorer"
      @update:foul-type="pendingFoulType = $event"
      @update:turnover-type="pendingTurnoverType = $event"
      @finish-shot="finishShotAction"
      @finish-foul="finishFoulAction"
      @finish-turnover="finishTurnoverAction"
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
    <MatchSyncDialog
      v-if="matchSyncOpen"
      :configured="matchSyncConfigured"
      :default-display-name="userProfile?.name"
      :match-link="matchLink"
      :status="matchSyncStatus"
      :error="matchSyncError"
      @close="matchSyncOpen = false"
      @create="createMatch"
      @join="joinMatch"
    />
    </template>

    <footer class="app-footer">
      <div class="footer-copy"><span class="footer-ball">◉</span> {{ t('app.footer') }} <span>·</span> Watchtower</div>
    </footer>
  </main>
</template>
