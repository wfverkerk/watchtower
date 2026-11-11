<script setup lang="ts">
import { useLocale } from '../i18n/useLocale'
import type { Player } from '../domain/game'
import PlayerChoiceButton from './PlayerChoiceButton.vue'

const { t } = useLocale()

defineProps<{
  teamName: string
  players: Player[]
  selectedPlayerIds: string[]
  periodLabel?: string
  error: string
  playerFouls: Record<string, number>
}>()

const emit = defineEmits<{
  cancel: []
  save: []
  toggle: [playerId: string]
}>()
</script>

<template>
  <div
    class="player-picker-backdrop"
    @click.self="emit('cancel')"
    @keydown.esc.window="emit('cancel')"
  >
    <section
      class="player-picker panel lineup-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lineup-picker-title"
      :aria-label="t('lineup.dialog', { team: teamName })"
    >
      <div class="player-picker-heading">
        <div>
          <p class="eyebrow">{{ teamName }} · {{ t('lineup.heading') }}</p>
          <h2 id="lineup-picker-title">{{ periodLabel === undefined ? t('lineup.chooseFive') : t('lineup.chooseForPeriod', { period: periodLabel }) }}</h2>
        </div>
      </div>
      <p class="lineup-count">{{ t('lineup.selectedCount', { count: selectedPlayerIds.length }) }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="lineup-player-grid">
        <PlayerChoiceButton
          v-for="player in players"
          :key="player.id"
          :player="player"
          :foul-count="playerFouls[player.id] ?? 0"
          :class="{ selected: selectedPlayerIds.includes(player.id) }"
          :aria-pressed="selectedPlayerIds.includes(player.id)"
          :disabled="!selectedPlayerIds.includes(player.id) && selectedPlayerIds.length === 5"
          @click="emit('toggle', player.id)"
        />
      </div>
      <div class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">{{ t('lineup.cancel') }}</button>
        <button class="picker-confirm" :disabled="selectedPlayerIds.length < 2 || selectedPlayerIds.length > 5" @click="emit('save')">
          {{ t(periodLabel === undefined ? 'lineup.confirm' : 'lineup.startPeriod') }}
        </button>
      </div>
    </section>
  </div>
</template>
