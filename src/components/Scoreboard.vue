<script setup lang="ts">
import { ref, watch } from 'vue'
import { useLocale } from '../i18n/useLocale'
import type { Team } from '../domain/game'
import { regulationPeriods } from '../domain/gameClock'

const { t, displayTeamName } = useLocale()

type ScoreNotification = { id: number; teamId: string; value: 1 | 2 | 3 }

const props = defineProps<{
  teams: Team[]
  scores: { id: string; points: number }[]
  scoreNotification: ScoreNotification | null
  gameStarted: boolean
  canStart: boolean
  canStartNewMatch: boolean
  period?: number
  youth: boolean
  clockDisplay: string
  clockPhase?: 'period' | 'halftime'
  clockRunning: boolean
  clockAvailable: boolean
  teamFouls: Record<string, number>
}>()

const scoreNotifications = ref<ScoreNotification[]>([])
watch(() => props.scoreNotification, (notification) => {
  if (notification) scoreNotifications.value.push(notification)
}, { flush: 'sync' })

function removeNotification(id: number) {
  scoreNotifications.value = scoreNotifications.value.filter((notification) => notification.id !== id)
}

const emit = defineEmits<{
  'team-name-change': [teamId: string, name: string]
  'toggle-game': []
  'new-match': []
  'next-period': []
  'toggle-clock': []
}>()
</script>

<template>
  <section class="scoreboard panel" :class="{ 'clock-running': clockRunning }" :aria-label="t('scoreboard.label')">
    <div class="team-score home-score">
      <span class="team-caption"><span class="team-dot orange"></span> {{ t('scoreboard.home') }}</span>
      <input
        class="team-name"
        :value="displayTeamName(teams[0])"
        :aria-label="t('scoreboard.homeName')"
        @input="emit('team-name-change', teams[0].id, ($event.target as HTMLInputElement).value)"
      >
      <span v-if="(teamFouls[teams[0].id] ?? 0) >= 5" class="foul-marker" role="img" :aria-label="t('scoreboard.teamFoulLimit')" :title="t('scoreboard.teamFoulLimit')"></span>
      <div class="score-value">
        <strong>{{ scores[0]?.points ?? 0 }}</strong>
        <span v-for="notification in scoreNotifications.filter((item) => item.teamId === teams[0].id)" :key="notification.id" class="score-increment" aria-hidden="true" @animationend="removeNotification(notification.id)">+{{ notification.value }}</span>
      </div>
    </div>
    <div class="score-middle">
      <div class="score-status">
        <span class="live-pill" :class="{ active: gameStarted }">
          <span></span>{{ gameStarted ? t('scoreboard.live') : t('scoreboard.ready') }}
        </span>
        <span v-if="period !== undefined && period > 0" class="period-label">{{ period > regulationPeriods(youth) ? t('scoreboard.overtime', { count: period - regulationPeriods(youth) }) : t(youth ? 'scoreboard.period' : 'scoreboard.quarter', { count: period }) }}</span>
      </div>
      <div v-if="clockAvailable" class="game-clock">
        <span v-if="clockPhase === 'halftime'" class="period-label">{{ t('scoreboard.halftime') }}</span>
        <time :aria-label="`${t('scoreboard.clock')}: ${clockDisplay}`"><span>{{ clockDisplay.split(':')[0] }}</span><span>:</span><span>{{ clockDisplay.split(':')[1] }}</span></time>
        <button type="button" class="clock-button" :disabled="!gameStarted || (!clockRunning && clockDisplay === '00:00')" @click="emit('toggle-clock')">
          {{ t(clockRunning ? 'scoreboard.pauseClock' : 'scoreboard.startClock') }}
        </button>
      </div>
      <button
        v-if="!gameStarted"
        class="start-button"
        :disabled="!canStart"
        @click="emit('toggle-game')"
      >
        {{ t('scoreboard.start') }}
        <span aria-hidden="true">▶</span>
      </button>
      <button v-if="period !== 0" class="new-match-button" type="button" @click="emit('next-period')">
        {{ t(period !== undefined && period >= regulationPeriods(youth) ? 'scoreboard.nextOvertime' : 'scoreboard.nextPeriod') }}
      </button>
      <button v-if="canStartNewMatch" class="new-match-button" type="button" @click="emit('new-match')">
        {{ t('teamSetup.newGame') }}
      </button>
    </div>
    <div class="team-score away-score">
      <span class="team-caption">{{ t('scoreboard.away') }} <span class="team-dot blue"></span></span>
      <input
        class="team-name"
        :value="displayTeamName(teams[1])"
        :aria-label="t('scoreboard.awayName')"
        @input="emit('team-name-change', teams[1].id, ($event.target as HTMLInputElement).value)"
      >
      <span v-if="(teamFouls[teams[1].id] ?? 0) >= 5" class="foul-marker" role="img" :aria-label="t('scoreboard.teamFoulLimit')" :title="t('scoreboard.teamFoulLimit')"></span>
      <div class="score-value">
        <strong>{{ scores[1]?.points ?? 0 }}</strong>
        <span v-for="notification in scoreNotifications.filter((item) => item.teamId === teams[1].id)" :key="notification.id" class="score-increment" aria-hidden="true" @animationend="removeNotification(notification.id)">+{{ notification.value }}</span>
      </div>
    </div>
  </section>
</template>
