<script setup lang="ts">
import type { Player } from '../domain/game'
import { useLocale } from '../i18n/useLocale'
import FoulMarker from './FoulMarker.vue'

defineProps<{
  player: Player
  foulCount: number
  noAssist?: boolean
}>()

const { t, displayPlayerName } = useLocale()
</script>

<template>
  <button type="button" class="player-choice picker-player" :class="{ 'coach-choice': player.isCoach && !noAssist }">
    <span v-if="!noAssist" class="jersey-number">{{ player.isCoach ? t(player.coachRole === 'assistant' ? 'picker.assistantCoach' : 'picker.coach') : player.jerseyNumber || '—' }}</span>
    <span class="player-choice-name">{{ noAssist ? t('picker.noAssist') : displayPlayerName(player.name) }}</span>
    <FoulMarker v-if="!noAssist && !player.isCoach" :count="foulCount" />
    <slot />
  </button>
</template>
