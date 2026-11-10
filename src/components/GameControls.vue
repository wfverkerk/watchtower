<script setup lang="ts">
import type { Player, StatType, Team } from '../domain/game'

defineProps<{
  teams: Team[]
  teamId: string
  selectedTeam: Team
  teamPlayers: Player[]
  onCourtPlayers: Player[]
  gameStarted: boolean
  canStart: boolean
  selectedPlayerId: string
  newPlayerName: string
  newPlayerNumber: string
  editingPlayerId: string
  playerFormError: string
  lineupError: string
  playerHasActions: (playerId: string) => boolean
}>()

const emit = defineEmits<{
  'update:teamId': [teamId: string]
  'update:selectedPlayerId': [playerId: string]
  'update:newPlayerName': [name: string]
  'update:newPlayerNumber': [number: string]
  'save-player': []
  'edit-player': [player: Player]
  'cancel-player-edit': []
  'remove-player': [playerId: string]
  'toggle-pregame-player': [player: Player]
  'add-action': [type: StatType, value?: number]
  'open-lineup-editor': []
}>()

function updateInput(event: Event, field: 'name' | 'number') {
  const value = (event.target as HTMLInputElement).value
  if (field === 'name') emit('update:newPlayerName', value)
  else emit('update:newPlayerNumber', value)
}
</script>

<template>
  <section class="panel logging-panel">
    <div class="section-title">
      <div>
        <p class="eyebrow">{{ gameStarted ? 'LIVE INVOER' : 'WEDSTRIJD VOORBEREIDEN' }}</p>
        <h2>{{ gameStarted ? 'Registreer een actie' : 'Spelers invoeren' }}</h2>
      </div>
      <span class="step-number">01</span>
    </div>

    <div class="team-switch" role="group" aria-label="Kies team">
      <button
        v-for="team in teams"
        :key="team.id"
        :class="{ selected: teamId === team.id }"
        @click="emit('update:teamId', team.id)"
      >
        <span class="team-dot" :class="team.id === 'home' ? 'orange' : 'blue'"></span>
        {{ team.name }}
      </button>
    </div>

    <template v-if="!gameStarted">
      <div class="roster-heading">
        <p class="field-label">Roster {{ teamId === 'home' ? 'thuis' : 'uit' }}</p>
        <span>{{ teamPlayers.filter((player) => player.isOnCourt).length }}/5 op het veld</span>
      </div>
      <div v-if="teamPlayers.length" class="roster-list">
        <div v-for="player in teamPlayers" :key="player.id" class="roster-row">
          <button
            class="player-choice"
            :class="{ selected: selectedPlayerId === player.id }"
            @click="emit('update:selectedPlayerId', player.id)"
          >
            <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
            <span class="player-choice-name">{{ player.name }}</span>
            <span class="court-status">{{ player.isOnCourt ? 'Veld' : 'Bank' }}</span>
          </button>
          <button
            class="court-toggle"
            :class="{ active: player.isOnCourt }"
            :aria-label="player.isOnCourt ? `Haal ${player.name} uit het veld` : `Zet ${player.name} in het veld`"
            @click="emit('toggle-pregame-player', player)"
          >{{ player.isOnCourt ? '−' : '+' }}</button>
          <button class="roster-edit" :aria-label="`Bewerk ${player.name}`" @click="emit('edit-player', player)">✎</button>
          <button
            class="roster-remove"
            :aria-label="`Verwijder ${player.name}`"
            :disabled="playerHasActions(player.id)"
            :title="playerHasActions(player.id) ? 'Deze speler heeft al geregistreerde acties' : 'Verwijder speler'"
            @click="emit('remove-player', player.id)"
          >×</button>
        </div>
      </div>
      <p v-else class="roster-empty">Voeg de spelers van dit team toe om de wedstrijd voor te bereiden.</p>

      <form class="player-form" @submit.prevent="emit('save-player')">
        <label class="player-input">
          <span>Naam speler</span>
          <input
            type="text"
            :value="newPlayerName"
            placeholder="Bijv. Alex Jansen"
            autocomplete="off"
            @input="updateInput($event, 'name')"
          >
        </label>
        <label class="player-input jersey-input">
          <span>Rugnummer</span>
          <input
            type="text"
            :value="newPlayerNumber"
            inputmode="numeric"
            maxlength="2"
            placeholder="00"
            aria-label="Rugnummer"
            @input="updateInput($event, 'number')"
          >
        </label>
        <button type="submit" class="add-player-button">{{ editingPlayerId ? 'Opslaan' : 'Toevoegen' }}</button>
        <button v-if="editingPlayerId" type="button" class="cancel-edit" @click="emit('cancel-player-edit')">Annuleren</button>
      </form>
      <p v-if="playerFormError" class="form-error" role="alert">{{ playerFormError }}</p>
      <p v-if="lineupError" class="form-error" role="alert">{{ lineupError }}</p>
      <p class="roster-requirement">
        {{ canStart ? 'Beide teams hebben vijf spelers op het veld.' : 'Zet precies vijf spelers met rugnummer in het veld bij beide teams.' }}
      </p>
    </template>

    <template v-else>
      <div class="live-team-label">
        <span class="team-dot" :class="teamId === 'home' ? 'orange' : 'blue'"></span>
        {{ selectedTeam.name }} · {{ onCourtPlayers.length }} op het veld
        <button class="lineup-change-button" @click="emit('open-lineup-editor')">Wisselen</button>
      </div>

      <div class="divider"></div>
      <div class="action-group">
        <p class="field-label action-label">Pogingen</p>
        <div class="action-grid">
          <button class="action-card scoring" aria-label="Vrije worp raak" @click="emit('add-action', 'score', 1)">
            <span class="action-icon">+FT</span>
          </button>
          <button class="action-card scoring" aria-label="2-punter raak" @click="emit('add-action', 'score', 2)">
            <span class="action-icon">+2</span>
          </button>
          <button class="action-card scoring" aria-label="3-punter raak" @click="emit('add-action', 'score', 3)">
            <span class="action-icon">+3</span>
          </button>
          <button class="action-card missed-shot" aria-label="Vrije worp gemist" @click="emit('add-action', 'missed_shot', 1)">
            <span class="action-icon missed-score-label">FT</span>
          </button>
          <button class="action-card missed-shot" aria-label="2-punter gemist" @click="emit('add-action', 'missed_shot', 2)">
            <span class="action-icon missed-score-label">2</span>
          </button>
          <button class="action-card missed-shot" aria-label="3-punter gemist" @click="emit('add-action', 'missed_shot', 3)">
            <span class="action-icon missed-score-label">3</span>
          </button>
        </div>
      </div>
      <div class="action-group">
        <p class="field-label action-label">Rebounds</p>
        <div class="action-grid action-grid-two">
          <button class="action-card" @click="emit('add-action', 'offensive_rebound')">
            <span class="action-icon">↗</span><span>Aanvallend</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'defensive_rebound')">
            <span class="action-icon">↙</span><span>Verdedigend</span>
          </button>
        </div>
      </div>
      <div class="action-group">
        <p class="field-label action-label">Overige acties</p>
        <div class="action-grid">
          <button class="action-card" @click="emit('add-action', 'assist')">
            <span class="action-icon">↗</span><span>Assist</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'turnover')">
            <span class="action-icon">↻</span><span>Turnover</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'foul')">
            <span class="action-icon">!</span><span>Fout</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'block')">
            <span class="action-icon">▰</span><span>Block</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'steal')">
            <span class="action-icon">↗</span><span>Steal</span>
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
