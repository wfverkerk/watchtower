<script setup lang="ts">
import { getActionLabel, type GameAction, type RecentAction, type Team, type TeamStats } from '../domain/game'

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
  return new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}
</script>

<template>
  <section class="panel activity-panel">
    <div class="section-title">
      <div>
        <p class="eyebrow">WEDSTRIJDOVERZICHT</p>
        <h2>Recente acties <span class="count">{{ actions.length }}</span></h2>
      </div>
      <span class="activity-mark" aria-hidden="true">↗</span>
    </div>

    <div v-if="recentActions.length" class="activity-list">
      <div v-for="item in recentActions" :key="item.action.id" class="activity-row">
        <span class="activity-dot" :class="item.action.teamId === 'home' ? 'orange' : 'blue'"></span>
        <div class="activity-description">
          <strong>
            {{ playerName(item.action.playerId) }}<span v-if="item.assistName" class="assist-attribution"> (assist {{ item.assistName }})</span>
          </strong>
          <span>{{ getActionLabel(item.action) }}</span>
        </div>
        <time>{{ actionTime(item.action.createdAt) }}</time>
        <button
          class="activity-edit"
          :aria-label="`Bewerk actie: ${playerName(item.action.playerId)} ${getActionLabel(item.action)}`"
          :title="`Bewerk actie: ${playerName(item.action.playerId)} ${getActionLabel(item.action)}`"
          @click="emit('edit-action', item.action)"
        >✎</button>
      </div>
    </div>
    <div v-else class="empty-state">
      <div class="empty-icon">◎</div>
      <strong>Nog geen acties</strong>
      <span>Geregistreerde acties verschijnen hier.</span>
    </div>

    <div class="divider"></div>
    <div class="stats-heading">
      <p class="eyebrow">TEAMSTATISTIEKEN</p>
      <span>LIVE</span>
    </div>
    <div class="team-stats">
      <div v-for="team in teams" :key="team.id" class="team-stat-row">
        <div class="team-stat-name">
          <span class="team-dot" :class="team.id === 'home' ? 'orange' : 'blue'"></span>
          <strong>{{ team.name }}</strong>
        </div>
        <div class="stat-values">
          <template v-for="stats in teamStats.filter((item) => item.teamId === team.id)" :key="stats.teamId">
            <span><b>{{ stats.offensiveRebounds }}</b> OREB</span>
            <span><b>{{ stats.defensiveRebounds }}</b> DREB</span>
            <span v-if="stats.legacyRebounds"><b>{{ stats.legacyRebounds }}</b> REB</span>
            <span><b>{{ stats.assists }}</b> AST</span>
            <span><b>{{ stats.turnovers }}</b> TO</span>
            <span><b>{{ stats.fouls }}</b> FLS</span>
            <span><b>{{ stats.blocks }}</b> BLK</span>
            <span><b>{{ stats.steals }}</b> STL</span>
            <span><b>{{ stats.missedShots }}</b> MIS</span>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
