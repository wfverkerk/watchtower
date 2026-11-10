<script setup lang="ts">
import { ref, watch } from 'vue'
import ActivityPanel from './components/ActivityPanel.vue'
import GameControls from './components/GameControls.vue'
import LineupDialog from './components/LineupDialog.vue'
import MatchSyncDialog from './components/MatchSyncDialog.vue'
import PlayerPickerDialog from './components/PlayerPickerDialog.vue'
import Scoreboard from './components/Scoreboard.vue'
import type { GameAction } from './domain/game'
import { useGameSession } from './composables/useGameSession'
import { appLocales, isAppLocale, localeLabels, saveLocale, useLocale } from './i18n/useLocale'

const { t, locale, displayTeamName } = useLocale()
const localeSaveError = ref(false)
const matchSyncOpen = ref(false)

type Theme = 'light' | 'dark'

const themeStorageKey = 'watchtower-theme'
const theme = ref<Theme>(localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light')

function applyTheme() {
  document.documentElement.dataset.theme = theme.value
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme.value === 'dark' ? '#17191f' : '#f7f6f3',
  )
}

applyTheme()

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme()
  localStorage.setItem(themeStorageKey, theme.value)
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
  scores,
  teamStats,
  recentActions,
  pendingAction,
  pendingScorerId,
  pendingAssistId,
  pendingShotLocation,
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
  playerName,
  addAction,
  selectPlayer,
  selectScorer,
  finishShotAction,
  cancelPendingAction,
  editAction,
  undoLastAction,
  toggleGame,
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

function changeLocale(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (!isAppLocale(value)) return

  locale.value = value
  localeSaveError.value = false
  try {
    saveLocale(value)
  } catch (error) {
    console.error('Failed to save language preference.', error)
    localeSaveError.value = true
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
        <span class="offline-indicator">
          <span :class="matchLink ? `sync-dot-${matchSyncStatus}` : ''"></span>
          {{ matchLink ? t(`sync.status.${matchSyncStatus}`) : t('app.savedLocally') }}
        </span>
        <button class="share-match-button" type="button" :aria-label="t('sync.open')" :title="t('sync.open')" @click="matchSyncOpen = true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4" />
          </svg>
        </button>
        <button
          class="theme-toggle"
          type="button"
          :aria-label="`Schakel naar ${theme === 'dark' ? 'lichte' : 'donkere'} modus`"
          :title="`Schakel naar ${theme === 'dark' ? 'lichte' : 'donkere'} modus`"
          :aria-pressed="theme === 'dark'"
          @click="toggleTheme"
        >
          <svg v-if="theme === 'dark'" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
          </svg>
        </button>
        <span class="avatar" :aria-label="t('app.profile')">J</span>
      </div>
    </header>

    <div v-if="storageError" class="notice" role="alert">{{ storageError }}</div>
    <div v-if="localeSaveError" class="notice" role="alert">{{ t('errors.saveLanguage') }}</div>

    <Scoreboard
      :teams="game.teams"
      :scores="scores"
      :game-started="game.gameStarted"
      :can-start="canStart"
      @team-name-change="updateTeamName"
      @toggle-game="toggleGame"
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
      @cancel="cancelPendingAction"
      @select-player="selectPlayer"
      @select-scorer="selectScorer"
      @finish-shot="finishShotAction"
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
      :match-link="matchLink"
      :status="matchSyncStatus"
      :error="matchSyncError"
      @close="matchSyncOpen = false"
      @create="createMatch"
      @join="joinMatch"
    />

    <footer>
      <div class="footer-copy"><span class="footer-ball">◉</span> {{ t('app.footer') }} <span>·</span> Watchtower</div>
      <label class="language-picker">
        <span class="visually-hidden">{{ t('app.language') }}</span>
        <select :value="locale" :aria-label="t('app.language')" @change="changeLocale">
          <option v-for="language in appLocales" :key="language" :value="language">{{ localeLabels[language] }}</option>
        </select>
      </label>
    </footer>
  </main>
</template>
