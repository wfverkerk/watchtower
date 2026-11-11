<script setup lang="ts">
import { computed } from 'vue'
import { getActionTranslation } from '../i18n/actionLabel'
import { getIntlLocale, isAppLocale, useLocale } from '../i18n/useLocale'
import type { GameAction, RecentAction, Team, TeamStats } from '../domain/game'
import FoulMarker from './FoulMarker.vue'

const { t, locale, displayTeamName, displayPlayerName } = useLocale()

const props = defineProps<{
  teams: Team[]
  actions: GameAction[]
  recentActions: RecentAction[]
  teamStats: TeamStats[]
  playerName: (playerId: string) => string
  canUndo: boolean
  playerFouls: Record<string, number>
  playerIsCoach: (playerId: string) => boolean
}>()

const emit = defineEmits<{
  'edit-action': [action: GameAction]
  'remove-opponent-score': [action: GameAction]
  undo: []
}>()

const timeFormatter = computed(() => {
  const activeLocale = isAppLocale(locale.value) ? locale.value : 'nl'
  return new Intl.DateTimeFormat(getIntlLocale(activeLocale), { hour: '2-digit', minute: '2-digit' })
})

function actionTime(timestamp: number) {
  return timeFormatter.value.format(timestamp)
}

function actionPlayer(action: GameAction) {
  if (action.playerId !== null) return props.playerName(action.playerId)
  const team = props.teams.find((item) => item.id === action.teamId)
  return team ? displayTeamName(team) : t('teamSetup.away')
}

function actionLabel(action: GameAction) {
  const { key, params } = getActionTranslation(action, isAppLocale(locale.value) ? locale.value : 'nl')
  return t(key, params ?? {})
}

function actionIcon(action: GameAction) {
  if (action.type === 'score') return `+${action.value === 1 ? 'FT' : action.value}`
  if (action.type === 'missed_shot') return action.value === 1 ? 'FT' : String(action.value)

  return {
    offensive_rebound: '↗',
    defensive_rebound: '↙',
    rebound: '↕',
    assist: 'A',
    turnover: '↻',
    foul: '!',
    block: '▰',
    steal: '↗',
  }[action.type]
}
</script>

<template>
  <section class="panel activity-panel">
    <div class="section-title">
      <div>
        <p class="eyebrow">{{ t('activity.heading') }}</p>
        <h2>{{ t('activity.recent') }} <span class="count">{{ actions.length }}</span></h2>
      </div>
      <div class="activity-header-actions">
        <button class="text-button activity-undo" :disabled="!canUndo" @click="emit('undo')">
          <span aria-hidden="true">↶</span><span class="activity-undo-label">{{ t('app.undo') }}</span>
        </button>
        <span class="activity-mark" aria-hidden="true">↗</span>
      </div>
    </div>

    <div v-if="recentActions.length" class="activity-list">
      <div v-for="item in recentActions" :key="item.action.id" class="activity-row">
        <span class="activity-dot" :class="item.action.teamId === 'home' ? 'orange' : 'blue'"></span>
        <span class="activity-action-icon" :class="`activity-action-icon-${item.action.type}`" aria-hidden="true">{{ actionIcon(item.action) }}</span>
        <div class="activity-description">
          <strong>
            {{ actionPlayer(item.action) }} <FoulMarker v-if="item.action.playerId !== null && !playerIsCoach(item.action.playerId)" :count="playerFouls[item.action.playerId] ?? 0" /><template v-if="item.assistName">&nbsp;<span class="assist-attribution">{{ t('activity.assistAttribution', { name: displayPlayerName(item.assistName) }) }}</span></template>
          </strong>
          <span>{{ actionLabel(item.action) }}</span>
        </div>
        <time>{{ actionTime(item.action.createdAt) }}</time>
        <button
          class="activity-edit"
          v-if="item.action.playerId !== null"
          :aria-label="t('activity.editAction', { player: actionPlayer(item.action), action: actionLabel(item.action) })"
          :title="t('activity.editAction', { player: actionPlayer(item.action), action: actionLabel(item.action) })"
          @click="emit('edit-action', item.action)"
        >✎</button>
        <button v-else class="activity-edit" :aria-label="t(item.action.value === 1 ? 'activity.removeOpponentPoint' : 'activity.removeOpponentScore', { team: actionPlayer(item.action), count: item.action.value })" :title="t(item.action.value === 1 ? 'activity.removeOpponentPoint' : 'activity.removeOpponentScore', { team: actionPlayer(item.action), count: item.action.value })" @click="emit('remove-opponent-score', item.action)">×</button>
      </div>
    </div>
    <div v-else class="empty-state">
      <div class="empty-icon">◎</div>
      <strong>{{ t('activity.emptyTitle') }}</strong>
      <span>{{ t('activity.emptyDescription') }}</span>
    </div>

    <div class="divider"></div>
    <div class="stats-heading">
      <p class="eyebrow">{{ t('activity.stats') }}</p>
      <span>{{ t('activity.live') }}</span>
    </div>
    <div class="team-stats">
      <div v-for="team in teams" :key="team.id" class="team-stat-row">
        <div class="team-stat-name">
          <span class="team-dot" :class="team.id === 'home' ? 'orange' : 'blue'"></span>
          <strong>{{ displayTeamName(team) }}</strong>
        </div>
        <div class="stat-values">
          <template v-for="stats in teamStats.filter((item) => item.teamId === team.id)" :key="stats.teamId">
            <span><b>{{ stats.offensiveRebounds }}</b> {{ t('activity.oreb') }}</span>
            <span><b>{{ stats.defensiveRebounds }}</b> {{ t('activity.dreb') }}</span>
            <span v-if="stats.legacyRebounds"><b>{{ stats.legacyRebounds }}</b> {{ t('activity.reb') }}</span>
            <span><b>{{ stats.assists }}</b> {{ t('activity.ast') }}</span>
            <span><b>{{ stats.turnovers }}</b> {{ t('activity.to') }}</span>
            <span><b>{{ stats.fouls }}</b> {{ t('activity.fouls') }}</span>
            <span><b>{{ stats.blocks }}</b> {{ t('activity.blk') }}</span>
            <span><b>{{ stats.steals }}</b> {{ t('activity.stl') }}</span>
            <span><b>{{ stats.missedShots }}</b> {{ t('activity.missed') }}</span>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
