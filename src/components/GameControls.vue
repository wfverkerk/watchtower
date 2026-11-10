<script setup lang="ts">
import { useLocale } from '../i18n/useLocale'
import type { Player, StatType, Team } from '../domain/game'

const { t, displayTeamName, displayPlayerName } = useLocale()

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
        <p class="eyebrow">{{ gameStarted ? t('controls.liveInput') : t('controls.prepare') }}</p>
        <h2>{{ gameStarted ? t('controls.registerAction') : t('controls.enterPlayers') }}</h2>
      </div>
      <span class="step-number">01</span>
    </div>

    <div class="team-switch" role="group" :aria-label="t('controls.chooseTeam')">
      <button
        v-for="team in teams"
        :key="team.id"
        :class="{ selected: teamId === team.id }"
        @click="emit('update:teamId', team.id)"
      >
        <span class="team-dot" :class="team.id === 'home' ? 'orange' : 'blue'"></span>
        {{ displayTeamName(team) }}
      </button>
    </div>

    <template v-if="!gameStarted">
      <div class="roster-heading">
        <p class="field-label">{{ t('controls.roster', { side: t(teamId === 'home' ? 'controls.homeSide' : 'controls.awaySide') }) }}</p>
        <span>{{ t('controls.onCourtCount', { count: teamPlayers.filter((player) => player.isOnCourt).length }) }}</span>
      </div>
      <div v-if="teamPlayers.length" class="roster-list">
        <div v-for="player in teamPlayers" :key="player.id" class="roster-row">
          <button
            class="player-choice"
            :class="{ selected: selectedPlayerId === player.id }"
            @click="emit('update:selectedPlayerId', player.id)"
          >
            <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
            <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
            <span class="court-status">{{ player.isOnCourt ? t('controls.court') : t('controls.bench') }}</span>
          </button>
          <button
            class="court-toggle"
            :class="{ active: player.isOnCourt }"
            :aria-label="t(player.isOnCourt ? 'controls.removeFromCourt' : 'controls.putOnCourt', { name: displayPlayerName(player.name) })"
            @click="emit('toggle-pregame-player', player)"
          >{{ player.isOnCourt ? '−' : '+' }}</button>
          <button class="roster-edit" :aria-label="t('controls.editPlayer', { name: displayPlayerName(player.name) })" @click="emit('edit-player', player)">✎</button>
          <button
            class="roster-remove"
            :aria-label="t('controls.removePlayer', { name: displayPlayerName(player.name) })"
            :disabled="playerHasActions(player.id)"
            :title="playerHasActions(player.id) ? t('controls.playerHasActions') : t('controls.removePlayer', { name: displayPlayerName(player.name) })"
            @click="emit('remove-player', player.id)"
          >×</button>
        </div>
      </div>
      <p v-else class="roster-empty">{{ t('controls.addRosterPrompt') }}</p>

      <form class="player-form" @submit.prevent="emit('save-player')">
        <label class="player-input">
          <span>{{ t('controls.playerName') }}</span>
          <input
            type="text"
            :value="newPlayerName"
            :placeholder="t('controls.namePlaceholder')"
            autocomplete="off"
            @input="updateInput($event, 'name')"
          >
        </label>
        <label class="player-input jersey-input">
          <span>{{ t('controls.jerseyNumber') }}</span>
          <input
            type="text"
            :value="newPlayerNumber"
            inputmode="numeric"
            maxlength="2"
            placeholder="00"
            :aria-label="t('controls.jerseyNumber')"
            @input="updateInput($event, 'number')"
          >
        </label>
        <button type="submit" class="add-player-button">{{ editingPlayerId ? t('controls.save') : t('controls.addPlayer') }}</button>
        <button v-if="editingPlayerId" type="button" class="cancel-edit" @click="emit('cancel-player-edit')">{{ t('controls.cancel') }}</button>
      </form>
      <p v-if="playerFormError" class="form-error" role="alert">{{ playerFormError }}</p>
      <p v-if="lineupError" class="form-error" role="alert">{{ lineupError }}</p>
      <p class="roster-requirement">
        {{ canStart ? t('controls.startReady') : t('controls.startRequirement') }}
      </p>
    </template>

    <template v-else>
      <div class="live-team-label">
        <span class="team-dot" :class="teamId === 'home' ? 'orange' : 'blue'"></span>
        {{ displayTeamName(selectedTeam) }} · {{ t('controls.playersOnCourt', { count: onCourtPlayers.length }) }}
        <button class="lineup-change-button" @click="emit('open-lineup-editor')">{{ t('controls.substitutions') }}</button>
      </div>

      <div class="divider"></div>
      <div class="action-group">
        <p class="field-label action-label">{{ t('controls.shots') }}</p>
        <div class="action-grid">
          <button class="action-card scoring" :aria-label="t('controls.freeThrowMade')" @click="emit('add-action', 'score', 1)">
            <span class="action-icon">+FT</span>
          </button>
          <button class="action-card scoring" :aria-label="t('controls.twoPointMade')" @click="emit('add-action', 'score', 2)">
            <span class="action-icon">+2</span>
          </button>
          <button class="action-card scoring" :aria-label="t('controls.threePointMade')" @click="emit('add-action', 'score', 3)">
            <span class="action-icon">+3</span>
          </button>
          <button class="action-card missed-shot" :aria-label="t('controls.freeThrowMissed')" @click="emit('add-action', 'missed_shot', 1)">
            <span class="action-icon missed-score-label">FT</span>
          </button>
          <button class="action-card missed-shot" :aria-label="t('controls.twoPointMissed')" @click="emit('add-action', 'missed_shot', 2)">
            <span class="action-icon missed-score-label">2</span>
          </button>
          <button class="action-card missed-shot" :aria-label="t('controls.threePointMissed')" @click="emit('add-action', 'missed_shot', 3)">
            <span class="action-icon missed-score-label">3</span>
          </button>
        </div>
      </div>
      <div class="action-group">
        <p class="field-label action-label">{{ t('controls.rebounds') }}</p>
        <div class="action-grid action-grid-two">
          <button class="action-card" @click="emit('add-action', 'offensive_rebound')">
            <span class="action-icon">↗</span><span>{{ t('controls.offensive') }}</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'defensive_rebound')">
            <span class="action-icon">↙</span><span>{{ t('controls.defensive') }}</span>
          </button>
        </div>
      </div>
      <div class="action-group">
        <p class="field-label action-label">{{ t('controls.otherActions') }}</p>
        <div class="action-grid">
          <button class="action-card" @click="emit('add-action', 'assist')">
            <span class="action-icon">↗</span><span>{{ t('controls.assist') }}</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'turnover')">
            <span class="action-icon">↻</span><span>{{ t('controls.turnover') }}</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'foul')">
            <span class="action-icon">!</span><span>{{ t('controls.foul') }}</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'block')">
            <span class="action-icon">▰</span><span>{{ t('controls.block') }}</span>
          </button>
          <button class="action-card" @click="emit('add-action', 'steal')">
            <span class="action-icon">↗</span><span>{{ t('controls.steal') }}</span>
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
