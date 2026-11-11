<script setup lang="ts">
import { ref, watch } from 'vue'
import ActivityPanel from './components/ActivityPanel.vue'
import GameControls from './components/GameControls.vue'
import LineupDialog from './components/LineupDialog.vue'
import MatchSyncDialog from './components/MatchSyncDialog.vue'
import PlayerPickerDialog from './components/PlayerPickerDialog.vue'
import Scoreboard from './components/Scoreboard.vue'
import TeamSetupDialog from './components/TeamSetupDialog.vue'
import UserProfileDialog from './components/UserProfileDialog.vue'
import type { GameAction } from './domain/game'
import type { TeamProfile } from './services/teamProfiles'
import { loadUserProfile, saveUserProfile as persistUserProfile, type UserProfile } from './services/userProfile'
import type { ZoebasMatch } from './services/zoebasMatches'
import { useGameSession } from './composables/useGameSession'
import { isAppLocale, saveLocale, useLocale } from './i18n/useLocale'

const { t, locale, displayTeamName } = useLocale()
const localeSaveError = ref(false)
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
  onCourtPlayers,
  pickerPlayers,
  canStart,
  canStartNewMatch,
  scores,
  teamStats,
  recentActions,
  pendingAction,
  pendingScorerId,
  pendingAssistId,
  pendingShotLocation,
  pendingFoulType,
  editingActionId,
  lineupEditorOpen,
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
  selectPlayer,
  selectScorer,
  finishShotAction,
  finishFoulAction,
  cancelPendingAction,
  editAction,
  undoLastAction,
  toggleGame,
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
  toggleDraftCourtPlayer,
  saveLineup,
  cancelLineupEdit,
  createSharedMatch,
  joinSharedMatch,
} = useGameSession()

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
    localeSaveError.value = false
  } catch (error) {
    console.error('Failed to save user preferences.', error)
    userProfileError.value = t('errors.saveUserProfile')
  }
}

function previewProfileLocale(value: UserProfile['locale']) {
  locale.value = value
  localeSaveError.value = false
}

function cancelUserProfileEdit() {
  userProfileOpen.value = false
  if (userProfile.value) locale.value = userProfile.value.locale
  previewTheme(savedTheme)
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
    <div v-if="localeSaveError" class="notice" role="alert">{{ t('errors.saveLanguage') }}</div>

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
      <Scoreboard
        :teams="game.teams"
        :scores="scores"
        :game-started="game.gameStarted"
        :can-start="canStart"
        :can-start-new-match="canStartNewMatch"
        @team-name-change="updateTeamName"
        @toggle-game="toggleGame"
        @new-match="openTeamSetup"
      />

    <div class="content-grid">
      <GameControls
        v-model:team-id="selectedTeamId"
        v-model:selected-player-id="selectedPlayerId"
        v-model:new-player-name="newPlayerName"
        v-model:new-player-number="newPlayerNumber"
        :teams="game.teams"
        :selected-team="selectedTeam"
        :team-players="teamPlayers"
        :on-court-players="onCourtPlayers"
        :game-started="game.gameStarted"
        :can-start="canStart"
        :editing-player-id="editingPlayerId"
        :player-form-error="playerFormError"
        :lineup-error="lineupError"
        :player-has-actions="playerHasActions"
        @save-player="savePlayer"
        @edit-player="editPlayer"
        @cancel-player-edit="cancelPlayerEdit"
        @remove-player="removePlayer"
        @toggle-pregame-player="togglePregamePlayer"
        @add-action="addAction"
        @open-lineup-editor="openLineupEditor"
      />
      <ActivityPanel
        :teams="game.teams"
        :actions="game.actions"
        :recent-actions="recentActions"
        :team-stats="teamStats"
        :player-name="playerName"
        :can-undo="game.actions.length > 0"
        @edit-action="handleEditAction"
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
      @cancel="cancelPendingAction"
      @select-player="selectPlayer"
      @select-scorer="selectScorer"
      @update:foul-type="pendingFoulType = $event"
      @finish-shot="finishShotAction"
      @finish-foul="finishFoulAction"
    />
    <LineupDialog
      v-if="lineupEditorOpen"
      :team-name="displayTeamName(selectedTeam)"
      :players="teamPlayers"
      :selected-player-ids="draftCourtPlayerIds"
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
