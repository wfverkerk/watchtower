<script setup lang="ts">
import { getActionTranslation } from '../i18n/actionLabel'
import { getIntlLocale, isAppLocale, useLocale } from '../i18n/useLocale'
import type { GameAction, RecentAction, Team, TeamStats } from '../domain/game'

const { t, locale, displayTeamName, displayPlayerName } = useLocale()

defineProps<{
  teams: Team[]
  actions: GameAction[]
  recentActions: RecentAction[]
  teamStats: TeamStats[]
  playerName: (playerId: string) => string
}>()

const emit = defineEmits<{
  'edit-action': [action: GameAction]
}>()

function actionTime(timestamp: number) {
  const activeLocale = isAppLocale(locale.value) ? locale.value : 'nl'
  return new Intl.DateTimeFormat(getIntlLocale(activeLocale), { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function actionLabel(action: GameAction) {
  const { key, params } = getActionTranslation(action, isAppLocale(locale.value) ? locale.value : 'nl')
  return t(key, params ?? {})
}
</script>

<template>
  <section class="panel activity-panel">
    <div class="section-title">
      <div>
        <p class="eyebrow">{{ t('activity.heading') }}</p>
        <h2>{{ t('activity.recent') }} <span class="count">{{ actions.length }}</span></h2>
      </div>
      <span class="activity-mark" aria-hidden="true">↗</span>
    </div>

    <div v-if="recentActions.length" class="activity-list">
      <div v-for="item in recentActions" :key="item.action.id" class="activity-row">
        <span class="activity-dot" :class="item.action.teamId === 'home' ? 'orange' : 'blue'"></span>
        <div class="activity-description">
          <strong>
            {{ playerName(item.action.playerId) }}<span v-if="item.assistName" class="assist-attribution"> {{ t('activity.assistAttribution', { name: displayPlayerName(item.assistName) }) }}</span>
          </strong>
          <span>{{ actionLabel(item.action) }}</span>
        </div>
        <time>{{ actionTime(item.action.createdAt) }}</time>
        <button
          class="activity-edit"
          :aria-label="t('activity.editAction', { player: playerName(item.action.playerId), action: actionLabel(item.action) })"
          :title="t('activity.editAction', { player: playerName(item.action.playerId), action: actionLabel(item.action) })"
          @click="emit('edit-action', item.action)"
        >✎</button>
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
