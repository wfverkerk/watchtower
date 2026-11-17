<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLocale } from '../i18n/useLocale'
import type { Team } from '../domain/game'
import { regulationPeriods } from '../domain/gameClock'
import TeamScore from './TeamScore.vue'

const { t, formatPeriod } = useLocale()

type ScoreNotification = { id: number; teamId: string; value: 1 | 2 | 3 }

const props = defineProps<{
  teams: Team[]
  scores: { id: string; points: number }[]
  scoreNotification: ScoreNotification | null
  gameStarted: boolean
  matchFinished?: boolean
  canFinishMatch?: boolean
  canStart: boolean
  canStartNewMatch: boolean
  period?: number
  youth: boolean
  teamFouls: Record<string, number>
  readOnly?: boolean
}>()

const periodText = computed(() => {
  const period = props.period ?? 0
  if (period <= 0) return ''
  return !props.youth || period > regulationPeriods(props.youth) ? formatPeriod(period, props.youth, true) : String(period)
})

const scoreNotifications = ref<ScoreNotification[]>([])
watch(() => props.scoreNotification, (notification) => {
  if (notification) scoreNotifications.value.push(notification)
}, { flush: 'sync' })

function removeNotification(id: number) {
  scoreNotifications.value = scoreNotifications.value.filter((notification) => notification.id !== id)
}

const emit = defineEmits<{
  'team-name-change': [teamId: string, name: string]
  'team-color-change': [teamId: string, color: string]
  'toggle-game': []
  'new-match': []
  'next-period': []
  'finish-match': []
}>()
</script>

<template>
  <section class="scoreboard panel" :aria-label="t('scoreboard.label')">
    <TeamScore :team="teams[0]" side="home" :points="scores[0]?.points ?? 0" :fouls="teamFouls[teams[0].id] ?? 0" :notifications="scoreNotifications.filter((item) => item.teamId === teams[0].id)" :read-only="readOnly" @name-change="(id, name) => emit('team-name-change', id, name)" @color-change="(id, color) => emit('team-color-change', id, color)" @notification-end="removeNotification" />
    <div class="score-middle">
      <div class="score-status">
        <span class="live-pill" :class="{ active: gameStarted }">
          <span></span>{{ t(matchFinished ? 'statistics.finished' : gameStarted ? 'scoreboard.live' : 'scoreboard.ready') }}
        </span>
      </div>
      <span v-if="periodText" class="score-period">{{ periodText }}</span>
      <template v-if="!readOnly">
        <button
          v-if="!gameStarted && !matchFinished"
          class="start-button"
          :disabled="!canStart"
          @click="emit('toggle-game')"
        >
          {{ t('scoreboard.start') }}
          <span aria-hidden="true">▶</span>
        </button>
        <button v-if="period !== 0 && !matchFinished" class="new-match-button" type="button" @click="emit('next-period')">
          {{ t(period !== undefined && period >= regulationPeriods(youth) ? 'scoreboard.nextOvertime' : 'scoreboard.nextPeriod') }}
        </button>
        <button v-if="canFinishMatch && !matchFinished" class="new-match-button" type="button" @click="emit('finish-match')">
          {{ t('statistics.finishMatch') }}
        </button>
        <button v-if="canStartNewMatch" class="new-match-button" type="button" @click="emit('new-match')">
          {{ t('teamSetup.newGame') }}
        </button>
      </template>
    </div>
    <TeamScore :team="teams[1]" side="away" :points="scores[1]?.points ?? 0" :fouls="teamFouls[teams[1].id] ?? 0" :notifications="scoreNotifications.filter((item) => item.teamId === teams[1].id)" :read-only="readOnly" @name-change="(id, name) => emit('team-name-change', id, name)" @color-change="(id, color) => emit('team-color-change', id, color)" @notification-end="removeNotification" />
  </section>
</template>
