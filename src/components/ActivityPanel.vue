<script setup lang="ts">
import { computed } from 'vue'
import { getActionTranslation } from '../i18n/actionLabel'
import { getIntlLocale, isAppLocale, useLocale } from '../i18n/useLocale'
import { isFoulCoachId, type GameAction, type RecentAction, type Team, type TeamStats } from '../domain/game'
import type { MatchTimelineEvent, TimelinePlayer } from '../domain/matchTimeline'
import FoulMarker from './FoulMarker.vue'

const { t, locale, displayTeamName, displayPlayerName, formatPeriod } = useLocale()

const props = defineProps<{
  teams: Team[]
  recentActions: RecentAction[]
  timeline: MatchTimelineEvent[]
  youth: boolean
  teamStats: TeamStats[]
  playerName: (playerId: string) => string
  canUndo: boolean
  playerFouls: Record<string, number>
  readOnly?: boolean
  hideStats?: boolean
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

const activityItems = computed(() => [
  ...props.recentActions.map((item) => ({ kind: 'action' as const, item, createdAt: item.action.createdAt })),
  ...[...props.timeline].reverse().map((item) => ({ kind: 'timeline' as const, item, createdAt: item.createdAt })),
].sort((a, b) => b.createdAt - a.createdAt))

function timelinePlayers(players: TimelinePlayer[]) {
  return players.map((player) => `${player.jerseyNumber ? `#${player.jerseyNumber} ` : ''}${displayPlayerName(player.name)}`).join(', ')
}

function actionTime(timestamp: number) {
  return timeFormatter.value.format(timestamp)
}

function actionPlayer(action: GameAction) {
  if (action.playerId !== null) return props.playerName(action.playerId)
  const team = props.teams.find((item) => item.id === action.teamId)
  return team ? displayTeamName(team) : t('teamSetup.away')
}

function isCoachAction(action: GameAction) {
  return isFoulCoachId(action.playerId)
}

function actionLabel(item: RecentAction) {
  const { key, params } = getActionTranslation(item.action, isAppLocale(locale.value) ? locale.value : 'nl', item.personalFoulNumber)
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
        <h2>{{ t('activity.recent') }} <span class="count">{{ activityItems.length }}</span></h2>
      </div>
      <div class="activity-header-actions">
        <button v-if="!readOnly" class="text-button activity-undo" :disabled="!canUndo" @click="emit('undo')">
          <span aria-hidden="true">↶</span><span class="activity-undo-label">{{ t('app.undo') }}</span>
        </button>
        <span class="activity-mark" aria-hidden="true">↗</span>
      </div>
    </div>

    <TransitionGroup v-show="activityItems.length" tag="div" name="activity" class="activity-list">
      <template v-for="entry in activityItems" :key="`${entry.kind}-${entry.kind === 'action' ? entry.item.action.id : entry.item.id}`">
      <div v-if="entry.kind === 'action'" class="activity-row" :style="{ '--activity-color': teams.find((team) => team.id === entry.item.action.teamId)?.color ?? 'var(--muted)' }">
        <template v-for="item in [entry.item]" :key="item.action.id">
        <span class="activity-dot" :class="item.action.teamId === teams[0]?.id ? 'orange' : 'blue'"></span>
        <span class="activity-action-icon" :class="`activity-action-icon-${item.action.type}`" aria-hidden="true">{{ actionIcon(item.action) }}</span>
        <div class="activity-description">
          <strong>
            <span v-if="isCoachAction(item.action)" class="activity-coach-marker" :title="t('picker.coach')">C</span>
            {{ actionPlayer(item.action) }} <FoulMarker v-if="item.action.playerId !== null && !isCoachAction(item.action)" :count="playerFouls[item.action.playerId] ?? 0" /><template v-if="item.assistName">&nbsp;<span class="assist-attribution">{{ t('activity.assistAttribution', { name: displayPlayerName(item.assistName) }) }}</span></template>
          </strong>
          <span>{{ actionLabel(item) }}</span>
        </div>
        <time>{{ actionTime(item.action.createdAt) }}</time>
        <button
          class="activity-edit"
          v-if="!readOnly && item.action.playerId !== null"
          :aria-label="t('activity.editAction', { player: actionPlayer(item.action), action: actionLabel(item) })"
          :title="t('activity.editAction', { player: actionPlayer(item.action), action: actionLabel(item) })"
          @click="emit('edit-action', item.action)"
        >✎</button>
        <button v-else-if="!readOnly && item.action.type === 'score'" class="activity-edit" :aria-label="t(item.action.value === 1 ? 'activity.removeOpponentPoint' : 'activity.removeOpponentScore', { team: actionPlayer(item.action), count: item.action.value })" :title="t(item.action.value === 1 ? 'activity.removeOpponentPoint' : 'activity.removeOpponentScore', { team: actionPlayer(item.action), count: item.action.value })" @click="emit('remove-opponent-score', item.action)">×</button>
        </template>
      </div>
      <div v-else class="activity-row" :style="{ '--activity-color': entry.item.type === 'substitution' ? teams[0]?.color : 'var(--muted)' }">
        <span class="activity-dot orange"></span>
        <span class="activity-action-icon" aria-hidden="true">{{ entry.item.type === 'substitution' ? '⇄' : '◷' }}</span>
        <div class="activity-description">
          <strong>{{ entry.item.type === 'substitution' ? t('activity.substitution') : t(entry.item.type === 'period_start' ? 'activity.periodStart' : 'activity.periodEnd', { period: formatPeriod(entry.item.period, youth) }) }}</strong>
          <template v-if="entry.item.type === 'substitution'">
            <span v-if="entry.item.out.length">{{ t('activity.playersOut', { players: timelinePlayers(entry.item.out) }) }}</span>
            <span v-if="entry.item.in.length">{{ t('activity.playersIn', { players: timelinePlayers(entry.item.in) }) }}</span>
          </template>
        </div>
        <time>{{ actionTime(entry.item.createdAt) }}</time>
      </div>
      </template>
    </TransitionGroup>
    <div v-if="!activityItems.length" class="empty-state">
      <div class="empty-icon">◎</div>
      <strong>{{ t('activity.emptyTitle') }}</strong>
      <span>{{ t('activity.emptyDescription') }}</span>
    </div>

    <div v-if="!hideStats" class="divider"></div>
    <div v-if="!hideStats" class="stats-heading">
      <p class="eyebrow">{{ t('activity.stats') }}</p>
      <span>{{ t('activity.live') }}</span>
    </div>
    <div v-if="!hideStats" class="team-stats">
      <div v-for="team in teams" :key="team.id" class="team-stat-row">
        <div class="team-stat-name">
          <span class="team-dot" :class="team.id === teams[0]?.id ? 'orange' : 'blue'"></span>
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
