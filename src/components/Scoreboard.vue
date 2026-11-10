<script setup lang="ts">
import type { Team } from '../domain/game'

defineProps<{
  teams: Team[]
  scores: { id: string; points: number }[]
  gameStarted: boolean
  canStart: boolean
}>()

const emit = defineEmits<{
  'team-name-change': [teamId: string, name: string]
  'toggle-game': []
}>()
</script>

<template>
  <section class="scoreboard panel" aria-label="Wedstrijdscore">
    <div class="team-score home-score">
      <span class="team-caption"><span class="team-dot orange"></span> THUIS</span>
      <input
        class="team-name"
        :value="teams[0].name"
        aria-label="Naam thuisteam"
        @input="emit('team-name-change', teams[0].id, ($event.target as HTMLInputElement).value)"
      >
      <strong>{{ scores[0]?.points ?? 0 }}</strong>
    </div>
    <div class="score-middle">
      <span class="live-pill" :class="{ active: gameStarted }">
        <span></span>{{ gameStarted ? 'LIVE' : 'KLAAR OM TE STARTEN' }}
      </span>
      <div class="versus">VS</div>
      <button
        class="start-button"
        :class="{ started: gameStarted }"
        :disabled="!gameStarted && !canStart"
        @click="emit('toggle-game')"
      >
        {{ gameStarted ? 'Pauze' : 'Start wedstrijd' }}
        <span aria-hidden="true">{{ gameStarted ? 'Ⅱ' : '▶' }}</span>
      </button>
    </div>
    <div class="team-score away-score">
      <span class="team-caption">UIT <span class="team-dot blue"></span></span>
      <input
        class="team-name"
        :value="teams[1].name"
        aria-label="Naam uitteam"
        @input="emit('team-name-change', teams[1].id, ($event.target as HTMLInputElement).value)"
      >
      <strong>{{ scores[1]?.points ?? 0 }}</strong>
    </div>
  </section>
</template>
