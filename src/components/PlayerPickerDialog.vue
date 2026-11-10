<script setup lang="ts">
import { getActionLabel, type Player, type StatType } from '../domain/game'

type PendingAction = { type: StatType; value: number }

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
</script>

<template>
  <div
    class="player-picker-backdrop"
    @click.self="emit('cancel')"
    @keydown.esc.window="emit('cancel')"
  >
    <section class="player-picker panel" role="dialog" aria-modal="true" aria-labelledby="player-picker-title">
      <div class="player-picker-heading">
        <div>
          <p
            v-if="action.type === 'score' || action.type === 'missed_shot'"
            id="player-picker-title"
            class="scoring-picker-title"
          >{{ teamName }} · {{ getActionLabel(action) }}</p>
          <template v-else>
            <p class="eyebrow">{{ teamName }} · {{ getActionLabel(action) }}</p>
            <h2 id="player-picker-title">Welke speler?</h2>
          </template>
        </div>
      </div>

      <div v-if="action.type === 'score'" class="scoring-player-lists">
        <section class="scoring-player-list" aria-label="Kies scorer">
          <h3>Scorer</h3>
          <div class="player-picker-grid">
            <button
              v-for="player in players"
              :key="player.id"
              class="player-choice picker-player"
              :class="{ selected: scorerId === player.id }"
              :aria-pressed="scorerId === player.id"
              @click="emit('select-scorer', player.id)"
            >
              <span class="player-choice-name">{{ player.name }}</span>
              <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
            </button>
            <span class="picker-empty-slot" aria-hidden="true"></span>
          </div>
        </section>
        <section v-if="action.value === 2 || action.value === 3" class="scoring-player-list" aria-label="Kies assistgever">
          <h3>Assistgever</h3>
          <div class="player-picker-grid">
            <button
              class="player-choice picker-player no-assist-button"
              :class="{ selected: assistPlayerId === 'none' }"
              :aria-pressed="assistPlayerId === 'none'"
              @click="emit('update:assistPlayerId', 'none')"
            >
              <span class="player-choice-name">Geen assist</span>
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
              <span class="player-choice-name">{{ player.name }}</span>
              <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
            </button>
          </div>
        </section>
      </div>
      <section v-else-if="action.type === 'missed_shot'" class="scoring-player-list missed-shot-player-list">
        <h3>Wie miste?</h3>
        <div class="player-picker-grid">
          <button
            v-for="player in players"
            :key="player.id"
            class="player-choice picker-player"
            :class="{ selected: editing && scorerId === player.id }"
            :aria-pressed="editing ? scorerId === player.id : undefined"
            @click="emit('select-player', player.id)"
          >
            <span class="player-choice-name">{{ player.name }}</span>
            <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
          </button>
          <span class="picker-empty-slot" aria-hidden="true"></span>
        </div>
      </section>
      <section v-else class="scoring-player-list standard-player-list" aria-label="Kies speler">
        <h3>{{ editing ? 'Wijzig speler' : 'Kies speler' }}</h3>
        <div class="player-picker-grid">
          <button
            v-for="player in players"
            :key="player.id"
            class="player-choice picker-player"
            :class="{ selected: editing && scorerId === player.id }"
            :aria-pressed="editing ? scorerId === player.id : undefined"
            @click="emit('select-player', player.id)"
          >
            <span class="player-choice-name">{{ player.name }}</span>
            <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
          </button>
          <span class="picker-empty-slot" aria-hidden="true"></span>
        </div>
      </section>

      <div v-if="action.type === 'score' && action.value > 1" class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">Annuleren</button>
        <button class="picker-confirm" :disabled="!scorerId || assistPlayerId === null" @click="emit('finish-scoring')">
          Score vastleggen
        </button>
      </div>
      <button v-else class="picker-cancel" @click="emit('cancel')">Annuleren</button>
    </section>
  </div>
</template>
