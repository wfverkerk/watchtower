<script setup lang="ts">
import ActivityPanel from './components/ActivityPanel.vue'
import GameControls from './components/GameControls.vue'
import LineupDialog from './components/LineupDialog.vue'
import PlayerPickerDialog from './components/PlayerPickerDialog.vue'
import Scoreboard from './components/Scoreboard.vue'
import type { GameAction } from './domain/game'
import { useGameSession } from './composables/useGameSession'

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
