<script setup lang="ts">
import type { Player } from '../domain/game'
import PlayerChoiceButton from './PlayerChoiceButton.vue'

const props = withDefaults(defineProps<{
  players: Player[]
  playerFouls: Record<string, number>
  selectedIds?: string[]
  noAssistPlayerId?: string
  disabled?: boolean
  maxSelections?: number
  showPressed?: boolean
}>(), {
  selectedIds: () => [],
  disabled: false,
  showPressed: true,
})

const emit = defineEmits<{ select: [playerId: string] }>()

function selectionId(player: Player) {
  return isNoAssist(player) ? 'none' : player.id
}

function isNoAssist(player: Player) {
  return props.noAssistPlayerId !== undefined && player.id === props.noAssistPlayerId
}

function selected(player: Player) {
  return props.selectedIds.includes(selectionId(player))
}
</script>

<template>
  <div>
    <PlayerChoiceButton
      v-for="player in players"
      :key="player.id"
      :player="player"
      :foul-count="playerFouls[player.id] ?? 0"
      :no-assist="isNoAssist(player)"
      :class="{ selected: selected(player), 'no-assist-button': isNoAssist(player) }"
      :aria-pressed="showPressed ? selected(player) : undefined"
      :disabled="disabled || (maxSelections !== undefined && !selected(player) && selectedIds.length >= maxSelections)"
      @click="emit('select', selectionId(player))"
    />
  </div>
</template>
