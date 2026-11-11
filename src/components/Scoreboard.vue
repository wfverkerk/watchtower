<script setup lang="ts">
import { useLocale } from '../i18n/useLocale'
import type { Team } from '../domain/game'

const { t, displayTeamName } = useLocale()

defineProps<{
  teams: Team[]
  scores: { id: string; points: number }[]
  gameStarted: boolean
  canStart: boolean
  canStartNewMatch: boolean
}>()

const emit = defineEmits<{
  'team-name-change': [teamId: string, name: string]
  'toggle-game': []
  'new-match': []
}>()
</script>

<template>
  <section class="scoreboard panel" :aria-label="t('scoreboard.label')">
    <div class="team-score home-score">
      <span class="team-caption"><span class="team-dot orange"></span> {{ t('scoreboard.home') }}</span>
      <input
        class="team-name"
        :value="displayTeamName(teams[0])"
        :aria-label="t('scoreboard.homeName')"
        @input="emit('team-name-change', teams[0].id, ($event.target as HTMLInputElement).value)"
      >
      <strong>{{ scores[0]?.points ?? 0 }}</strong>
    </div>
    <div class="score-middle">
      <span class="live-pill" :class="{ active: gameStarted }">
        <span></span>{{ gameStarted ? t('scoreboard.live') : t('scoreboard.ready') }}
      </span>
      <div class="versus">VS</div>
      <button
        class="start-button"
        :class="{ started: gameStarted }"
        :disabled="!gameStarted && !canStart"
        @click="emit('toggle-game')"
      >
        {{ gameStarted ? t('scoreboard.pause') : t('scoreboard.start') }}
        <span aria-hidden="true">{{ gameStarted ? 'Ⅱ' : '▶' }}</span>
      </button>
      <button v-if="canStartNewMatch" class="new-match-button" type="button" @click="emit('new-match')">
        {{ t('teamSetup.newGame') }}
      </button>
    </div>
    <div class="team-score away-score">
      <span class="team-caption">{{ t('scoreboard.away') }} <span class="team-dot blue"></span></span>
      <input
        class="team-name"
        :value="displayTeamName(teams[1])"
        :aria-label="t('scoreboard.awayName')"
        @input="emit('team-name-change', teams[1].id, ($event.target as HTMLInputElement).value)"
      >
      <strong>{{ scores[1]?.points ?? 0 }}</strong>
    </div>
  </section>
</template>
