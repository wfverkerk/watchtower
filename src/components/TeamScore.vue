<script setup lang="ts">
import type { Team } from '../domain/game'
import { useLocale } from '../i18n/useLocale'

defineProps<{
  team: Team
  side: 'home' | 'away'
  points: number
  fouls: number
  notifications: { id: number; value: 1 | 2 | 3 }[]
}>()

const emit = defineEmits<{
  'name-change': [teamId: string, name: string]
  'notification-end': [id: number]
}>()
const { t, displayTeamName } = useLocale()
</script>

<template>
  <div class="team-score" :class="`${side}-score`">
    <span class="team-caption">
      <span v-if="side === 'home'" class="team-dot orange"></span>
      {{ t(side === 'home' ? 'scoreboard.home' : 'scoreboard.away') }}
      <span v-if="side === 'away'" class="team-dot blue"></span>
    </span>
    <input
      class="team-name"
      :value="displayTeamName(team)"
      :aria-label="t(side === 'home' ? 'scoreboard.homeName' : 'scoreboard.awayName')"
      @input="emit('name-change', team.id, ($event.target as HTMLInputElement).value)"
    >
    <span v-if="fouls >= 5" class="foul-marker" role="img" :aria-label="t('scoreboard.teamFoulLimit')" :title="t('scoreboard.teamFoulLimit')"></span>
    <div class="score-value">
      <strong>{{ points }}</strong>
      <span v-for="notification in notifications" :key="notification.id" class="score-increment" aria-hidden="true" @animationend="emit('notification-end', notification.id)">+{{ notification.value }}</span>
    </div>
  </div>
</template>
