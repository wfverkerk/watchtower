<script setup lang="ts">
import { computed } from 'vue'
import { getCoachMarker, type Player } from '../domain/game'
import { useLocale } from '../i18n/useLocale'
import FoulMarker from './FoulMarker.vue'

const props = defineProps<{
  player: Player
  foulCount: number
  selected: boolean
}>()

const { displayPlayerName } = useLocale()
const jersey = computed(() => getCoachMarker(props.player, props.player.id) ?? (props.player.jerseyNumber || '—'))
</script>

<template>
  <button type="button" class="event-flow-player" :class="{ selected }" :aria-pressed="selected">
    <span class="event-flow-number">{{ jersey }}</span>
    <span class="event-flow-name">{{ displayPlayerName(player.name) }}</span>
    <FoulMarker v-if="!player.isCoach" :count="foulCount" />
  </button>
</template>
