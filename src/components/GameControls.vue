<script setup lang="ts">
import { useLocale } from '../i18n/useLocale'
import type { Player, StatType } from '../domain/game'

const { t, displayPlayerName } = useLocale()

defineProps<{
  teamId: string
  teamPlayers: Player[]
  gameStarted: boolean
  canStart: boolean
  awaitingFirstPeriod: boolean
}>()

const emit = defineEmits<{
  'edit-roster': []
  'edit-lineup': []
  'add-action': [type: StatType, value?: number]
  'opponent-score': [value: 1 | 2 | 3]
}>()
</script>

<template>
  <section class="panel logging-panel">
    <div v-if="!gameStarted" class="section-title">
      <div>
        <p class="eyebrow">{{ t('controls.prepare') }}</p>
        <h2>{{ t('controls.enterPlayers') }}</h2>
      </div>
      <span class="step-number">01</span>
    </div>

    <template v-if="!gameStarted">
      <div class="roster-heading">
        <p class="field-label">{{ t('controls.roster', { side: t(teamId === 'home' ? 'controls.homeSide' : 'controls.awaySide') }) }}</p>
        <span>{{ t('controls.onCourtCount', { count: teamPlayers.filter((player) => player.isOnCourt).length }) }}</span>
      </div>
      <ul v-if="teamPlayers.length" class="pregame-roster">
        <li v-for="player in teamPlayers" :key="player.id">
          <span>{{ player.jerseyNumber ? `#${player.jerseyNumber} ` : '' }}{{ displayPlayerName(player.name) }}</span>
          <span>{{ player.isOnCourt ? t('controls.court') : t('controls.bench') }}</span>
        </li>
      </ul>
      <p v-else class="roster-empty">{{ t('controls.addRosterPrompt') }}</p>
      <div class="pregame-roster-actions">
        <button class="team-setup-secondary" type="button" @click="emit('edit-roster')">{{ t('scoreboard.editPlayers') }}</button>
        <button class="team-setup-secondary" type="button" @click="emit('edit-lineup')">{{ t('controls.chooseLineup') }}</button>
      </div>
      <p class="roster-requirement">
        {{ awaitingFirstPeriod ? t('controls.firstPeriodRequirement') : canStart ? t('controls.startReady') : t('controls.startRequirement') }}
      </p>
    </template>

    <template v-else>
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
        <p class="field-label action-label">{{ t('scoreboard.opponentScore') }}</p>
        <div class="action-grid" role="group" :aria-label="t('scoreboard.opponentScore')">
          <button
            v-for="value in ([1, 2, 3] as const)"
            :key="value"
            class="action-card opponent-scoring"
            type="button"
            :aria-label="t(value === 1 ? 'scoreboard.addOpponentPoint' : 'scoreboard.addOpponentPoints', { count: value })"
            @click="emit('opponent-score', value)"
          ><span class="action-icon">+{{ value }}</span></button>
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
