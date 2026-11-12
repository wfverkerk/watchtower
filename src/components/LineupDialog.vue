<script setup lang="ts">
import { useLocale } from '../i18n/useLocale'
import type { Player } from '../domain/game'
import PlayerSelectionList from './PlayerSelectionList.vue'
import BaseDialog from './BaseDialog.vue'

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
  <BaseDialog
    backdrop-class="player-picker-backdrop"
    dialog-class="player-picker panel lineup-picker"
    labelledby="lineup-picker-title"
    :label="t('lineup.dialog', { team: teamName })"
    close-on-backdrop
    @close="emit('cancel')"
  >
      <div class="player-picker-heading">
        <div>
          <p class="eyebrow">{{ teamName }} · {{ t('lineup.heading') }}</p>
          <h2 id="lineup-picker-title">{{ periodLabel === undefined ? t('lineup.chooseFive') : t('lineup.chooseForPeriod', { period: periodLabel }) }}</h2>
        </div>
      </div>
      <p class="lineup-count">{{ t('lineup.selectedCount', { count: selectedPlayerIds.length }) }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <PlayerSelectionList
        class="lineup-player-grid"
        :players="players"
        :player-fouls="playerFouls"
        :selected-ids="selectedPlayerIds"
        :max-selections="5"
        @select="emit('toggle', $event)"
      />
      <div class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">{{ t('lineup.cancel') }}</button>
        <button class="picker-confirm" :disabled="selectedPlayerIds.length < 2 || selectedPlayerIds.length > 5" @click="emit('save')">
          {{ t(periodLabel === undefined ? 'lineup.confirm' : 'lineup.startPeriod') }}
        </button>
      </div>
  </BaseDialog>
</template>
