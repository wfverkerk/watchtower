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
  <button type="button" class="player-choice picker-player">
    <span v-if="!noAssist" class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
    <span class="player-choice-name">{{ noAssist ? t('picker.noAssist') : displayPlayerName(player.name) }}</span>
    <FoulMarker v-if="!noAssist" :count="foulCount" />
    <slot />
  </button>
</template>
