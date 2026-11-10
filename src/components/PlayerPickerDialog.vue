<script setup lang="ts">
import { getActionTranslation } from '../i18n/actionLabel'
import { isAppLocale, useLocale } from '../i18n/useLocale'
import type { Player, StatType } from '../domain/game'

type PendingAction = { type: StatType; value: number }

const { t, locale, displayPlayerName } = useLocale()

defineProps<{
  action: PendingAction
  teamName: string
  players: Player[]
  scorerId: string
  assistPlayerId: string | 'none' | null
  editing: boolean
}>()

const emit = defineEmits<{
  cancel: []
  'select-player': [playerId: string]
  'select-scorer': [playerId: string]
  'update:assistPlayerId': [playerId: string | 'none' | null]
  'finish-scoring': []
}>()

function actionLabel(action: PendingAction) {
  const { key, params } = getActionTranslation(action, isAppLocale(locale.value) ? locale.value : 'nl')
  return t(key, params ?? {})
}
</script>

<template>
  <div
    class="player-picker-backdrop"
    @click.self="emit('cancel')"
    @keydown.esc.window="emit('cancel')"
  >
    <section
      class="player-picker panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-picker-title"
      :aria-label="t(action.type === 'score' ? 'picker.scoringDialog' : 'picker.playerDialog', { team: teamName, action: actionLabel(action) })"
    >
      <div class="player-picker-heading">
        <div>
          <p
            v-if="action.type === 'score' || action.type === 'missed_shot'"
            id="player-picker-title"
            class="scoring-picker-title"
          >{{ teamName }} · {{ actionLabel(action) }}</p>
          <template v-else>
            <p class="eyebrow">{{ teamName }} · {{ actionLabel(action) }}</p>
            <h2 id="player-picker-title">{{ t('picker.choosePlayer') }}</h2>
          </template>
        </div>
      </div>

      <div v-if="action.type === 'score'" class="scoring-player-lists">
        <section class="scoring-player-list scorer-player-list" :aria-label="t('picker.chooseScorer')">
          <h3>{{ t('picker.scorer') }}</h3>
          <div class="player-picker-grid">
            <button
              v-for="player in players"
              :key="player.id"
              class="player-choice picker-player"
              :class="{ selected: scorerId === player.id }"
              :aria-pressed="scorerId === player.id"
              @click="emit('select-scorer', player.id)"
            >
              <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
              <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
            </button>
            <span class="picker-empty-slot" aria-hidden="true"></span>
          </div>
        </section>
        <section
          v-if="action.value === 2 || action.value === 3"
          class="scoring-player-list assist-player-list"
          :aria-label="t('picker.chooseAssister')"
        >
          <h3>{{ t('picker.assister') }}</h3>
          <div class="player-picker-grid">
            <button
              class="player-choice picker-player no-assist-button"
              :class="{ selected: assistPlayerId === 'none' }"
              :aria-pressed="assistPlayerId === 'none'"
              @click="emit('update:assistPlayerId', 'none')"
            >
              <span class="player-choice-name">{{ t('picker.noAssist') }}</span>
              <span class="jersey-number">—</span>
            </button>
            <button
              v-for="player in players"
              :key="player.id"
              class="player-choice picker-player"
              :class="{ selected: assistPlayerId === player.id }"
              :aria-pressed="assistPlayerId === player.id"
              :disabled="!scorerId || player.id === scorerId"
              @click="emit('update:assistPlayerId', player.id)"
            >
              <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
              <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
            </button>
          </div>
        </section>
      </div>
      <section v-else-if="action.type === 'missed_shot'" class="scoring-player-list missed-shot-player-list">
        <h3>{{ t('picker.missedBy') }}</h3>
        <div class="player-picker-grid">
          <button
            v-for="player in players"
            :key="player.id"
            class="player-choice picker-player"
            :class="{ selected: editing && scorerId === player.id }"
            :aria-pressed="editing ? scorerId === player.id : undefined"
            @click="emit('select-player', player.id)"
          >
            <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
            <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
          </button>
          <span class="picker-empty-slot" aria-hidden="true"></span>
        </div>
      </section>
      <section v-else class="scoring-player-list standard-player-list" :aria-label="t('picker.choosePlayerLabel')">
        <h3>{{ editing ? t('picker.changePlayer') : t('picker.choosePlayerLabel') }}</h3>
        <div class="player-picker-grid">
          <button
            v-for="player in players"
            :key="player.id"
            class="player-choice picker-player"
            :class="{ selected: editing && scorerId === player.id }"
            :aria-pressed="editing ? scorerId === player.id : undefined"
            @click="emit('select-player', player.id)"
          >
            <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
            <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
          </button>
          <span class="picker-empty-slot" aria-hidden="true"></span>
        </div>
      </section>

      <div v-if="action.type === 'score' && action.value > 1" class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">{{ t('picker.cancel') }}</button>
        <button class="picker-confirm" :disabled="!scorerId || assistPlayerId === null" @click="emit('finish-scoring')">
          {{ t('picker.confirmScore') }}
        </button>
      </div>
      <button v-else class="picker-cancel" @click="emit('cancel')">{{ t('picker.cancel') }}</button>
    </section>
  </div>
</template>
