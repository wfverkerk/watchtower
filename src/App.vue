<script setup lang="ts">
import { ref } from 'vue'
import ActivityPanel from './components/ActivityPanel.vue'
import GameControls from './components/GameControls.vue'
import LineupDialog from './components/LineupDialog.vue'
import PlayerPickerDialog from './components/PlayerPickerDialog.vue'
import Scoreboard from './components/Scoreboard.vue'
import type { GameAction } from './domain/game'
import { useGameSession } from './composables/useGameSession'

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
  editingActionId,
  lineupEditorOpen,
  draftCourtPlayerIds,
  newPlayerName,
  newPlayerNumber,
  playerFormError,
  lineupError,
  editingPlayerId,
  storageError,
  playerName,
  addAction,
  selectPlayer,
  selectScorer,
  finishScoringAction,
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
} = useGameSession()

function updateTeamName(teamId: string, name: string) {
  const team = game.teams.find((item) => item.id === teamId)
  if (team) team.name = name
}

function handleEditAction(action: GameAction) {
  editAction(action)
}
</script>

<template>
  <main class="app-shell" :class="{ 'game-live': game.gameStarted }">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Watchtower startpagina">
        <span class="brand-mark">W</span>
        <span>watchtower<span class="brand-dot">.</span></span>
      </a>
      <div class="topbar-right">
        <span class="offline-indicator"><span></span> Lokaal opgeslagen</span>
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
        <span class="avatar" aria-label="Jouw profiel">J</span>
      </div>
    </header>

    <div v-if="storageError" class="notice" role="alert">{{ storageError }}</div>

    <section class="page-heading">
      <div>
        <p class="eyebrow">WEDSTRIJDEN <span>/</span> NIEUWE WEDSTRIJD</p>
        <h1>Wedstrijd loggen</h1>
        <p class="subtitle">Houd live de statistieken bij. Je invoer wordt automatisch bewaard.</p>
      </div>
      <button class="text-button" :disabled="game.actions.length === 0" @click="undoLastAction">
        <span aria-hidden="true">↶</span> Laatste actie ongedaan maken
      </button>
    </section>

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
        @edit-action="handleEditAction"
      />
    </div>

    <PlayerPickerDialog
      v-if="pendingAction"
      v-model:assist-player-id="pendingAssistId"
      :action="pendingAction"
      :team-name="selectedTeam.name"
      :players="pickerPlayers"
      :scorer-id="pendingScorerId"
      :editing="editingActionId !== null"
      @cancel="cancelPendingAction"
      @select-player="selectPlayer"
      @select-scorer="selectScorer"
      @finish-scoring="finishScoringAction"
    />
    <LineupDialog
      v-if="lineupEditorOpen"
      :team-name="selectedTeam.name"
      :players="teamPlayers"
      :selected-player-ids="draftCourtPlayerIds"
      @cancel="cancelLineupEdit"
      @save="saveLineup"
      @toggle="toggleDraftCourtPlayer"
    />

    <footer><span class="footer-ball">◉</span> Made for the love of the game <span>·</span> Watchtower</footer>
  </main>
</template>
