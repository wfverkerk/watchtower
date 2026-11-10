<script setup lang="ts">
import { useLocale } from '../i18n/useLocale'
import type { Player } from '../domain/game'

const { t, displayPlayerName } = useLocale()

defineProps<{
  teamName: string
  players: Player[]
  selectedPlayerIds: string[]
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
          <h2 id="lineup-picker-title">{{ t('lineup.chooseFive') }}</h2>
        </div>
      </div>
      <p class="lineup-count">{{ t('lineup.selectedCount', { count: selectedPlayerIds.length }) }}</p>
      <div class="lineup-player-grid">
        <button
          v-for="player in players"
          :key="player.id"
          class="player-choice picker-player"
          :class="{ selected: selectedPlayerIds.includes(player.id) }"
          :aria-pressed="selectedPlayerIds.includes(player.id)"
          :disabled="!selectedPlayerIds.includes(player.id) && selectedPlayerIds.length === 5"
          @click="emit('toggle', player.id)"
        >
          <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
          <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
        </button>
      </div>
      <div class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">{{ t('lineup.cancel') }}</button>
        <button class="picker-confirm" :disabled="selectedPlayerIds.length !== 5" @click="emit('save')">
          {{ t('lineup.confirm') }}
        </button>
      </div>
    </section>
  </div>
</template>
