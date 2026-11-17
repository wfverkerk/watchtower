<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Team } from '../domain/game'
import { useLocale } from '../i18n/useLocale'
import { teamColorPalette } from '../composables/teamColors'

const props = defineProps<{
  team: Team
  side: 'home' | 'away'
  points: number
  fouls: number
  notifications: { id: number; value: 1 | 2 | 3 }[]
  readOnly?: boolean
}>()

const emit = defineEmits<{
  'name-change': [teamId: string, name: string]
  'color-change': [teamId: string, color: string]
  'notification-end': [id: number]
}>()
const { t, displayTeamName } = useLocale()
const paletteOpen = ref(false)
const canChangeColor = computed(() => !props.readOnly && !props.team.zoebas)
const clubLabel = computed(() => {
  const club = props.team.club ?? (props.team.zoebas ? 'Zoebas' : '')
  return club && club !== props.team.name ? club : ''
})

function chooseColor(teamId: string, color: string) {
  paletteOpen.value = false
  emit('color-change', teamId, color)
}
</script>

<template>
  <div class="team-score" :class="`${side}-score`">
    <div class="team-main">
      <div class="team-identity">
        <div class="team-club-row">
          <button v-if="canChangeColor" type="button" class="team-color-button" :style="{ background: team.color }" :aria-expanded="paletteOpen ? 'true' : 'false'" :aria-label="t('scoreboard.teamColor')" @click="paletteOpen = !paletteOpen"></button>
          <span v-else class="team-color-button" :style="{ background: team.color }" aria-hidden="true"></span>
          <span v-if="clubLabel" class="team-club">{{ clubLabel }}</span>
        </div>
        <input
          class="team-name"
          :size="Math.max(displayTeamName(team).length, 4)"
          :value="displayTeamName(team)"
          :readonly="readOnly"
          :aria-label="t(side === 'home' ? 'scoreboard.homeName' : 'scoreboard.awayName')"
          @input="emit('name-change', team.id, ($event.target as HTMLInputElement).value)"
        >
        <span v-if="fouls >= 5" class="foul-marker" role="img" :aria-label="t('scoreboard.teamFoulLimit')" :title="t('scoreboard.teamFoulLimit')"></span>
      </div>
      <div class="score-row">
        <div class="score-value">
          <strong>{{ points }}</strong>
          <span v-for="notification in notifications" :key="notification.id" class="score-increment" aria-hidden="true" @animationend="emit('notification-end', notification.id)">+{{ notification.value }}</span>
        </div>
      </div>
    </div>
    <div v-if="paletteOpen && canChangeColor" class="team-color-palette" role="group" :aria-label="t('scoreboard.teamColor')">
      <button v-for="color in teamColorPalette" :key="color" type="button" class="team-color-swatch" :style="{ background: color }" :aria-pressed="color === team.color ? 'true' : 'false'" :aria-label="color" @click="chooseColor(team.id, color)"></button>
    </div>
  </div>
</template>
