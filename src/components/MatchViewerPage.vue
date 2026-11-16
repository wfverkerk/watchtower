<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ActivityPanel from './ActivityPanel.vue'
import FoulMarker from './FoulMarker.vue'
import Scoreboard from './Scoreboard.vue'
import ThankYouOverlay from './ThankYouOverlay.vue'
import { errorMessage } from '../domain/guards'
import { getPeriodTeamFouls, getPlayerFouls, getRecentActions, getScore, getTeamStats, type GameState } from '../domain/game'
import { useLocale } from '../i18n/useLocale'
import { loadSharedGame } from '../services/sharedMatch'
import { loadMatchScorers } from '../services/statistics'
import { viewerActions, watchViewerMatch, type ViewerMatch } from '../services/viewerMatch'

const props = defineProps<{ matchId: string }>()
const emit = defineEmits<{ close: [] }>()
const { t, displayPlayerName } = useLocale()

const base = ref<GameState | null>(null)
const match = ref<ViewerMatch | null>(null)
const scorerName = ref('')
const error = ref('')
let stop: (() => void) | undefined
let unmounted = false

// A viewer has no local game: the plan comes from the session, the registrations from the events and the lineup from the scorer.
const game = computed<GameState | null>(() => {
  if (!base.value || !match.value) return null
  const { state } = match.value
  const actions = viewerActions(base.value, match.value).map((item) => item.action)
  return {
    ...base.value,
    players: (state?.players ?? []).map((player) => ({ ...player, teamId: state!.teamId })),
    actions,
    gameStarted: state?.gameStarted ?? actions.length > 0,
    period: state?.period,
    youth: state?.youth ?? base.value.youth,
    timeline: state?.timeline ?? [],
  }
})
const scores = computed(() => game.value ? getScore(game.value) : [])
const endOpen = ref(false)
const endTeams = computed(() => game.value?.teams.map((team, index) => ({
  id: team.id, name: team.name, points: scores.value[index]?.points ?? 0,
})) ?? [])
const playerFouls = computed(() => game.value ? getPlayerFouls(game.value.actions) : {})
const teamStats = computed(() => game.value ? getTeamStats(game.value) : [])
const teamFouls = computed(() => game.value ? getPeriodTeamFouls(game.value) : {})
const recentActions = computed(() => game.value
  ? getRecentActions(game.value, game.value.actions.length, t('app.unknownPlayer'))
  : [])
const onCourt = computed(() => game.value?.players.filter((player) => player.isOnCourt) ?? [])
const started = computed(() => !!game.value && (game.value.gameStarted || (game.value.period ?? 0) > 0))
const hasActivity = computed(() => !!game.value && (game.value.actions.length > 0 || (game.value.timeline?.length ?? 0) > 0))

function playerName(playerId: string) {
  return game.value?.players.find((player) => player.id === playerId)?.name ?? t('app.unknownPlayer')
}

async function refreshScorer() {
  try {
    scorerName.value = (await loadMatchScorers(props.matchId)).scorerName ?? ''
  } catch (reason) {
    console.error('Failed to load the scorer.', reason)
  }
}

watch(() => match.value?.scorerId, () => { void refreshScorer() })

// Only a match that ends while the viewer is watching gets the end animation; one that was already finished when opened does not.
let seenOpen = false
let endShown = false
watch(match, (value) => {
  if (!value) return
  if (!value.finishedAt) { seenOpen = true; return }
  if (seenOpen && !endShown) {
    endShown = true
    endOpen.value = true
  }
}, { flush: 'sync' })

onMounted(async () => {
  try {
    base.value = await loadSharedGame(props.matchId)
    const cleanup = await watchViewerMatch(props.matchId, (value) => { match.value = value }, (message) => { error.value = message })
    if (unmounted) cleanup()
    else stop = cleanup
  } catch (reason) {
    console.error('Failed to follow the match.', reason)
    error.value = errorMessage(reason)
  }
})
onUnmounted(() => {
  unmounted = true
  stop?.()
})
</script>

<template>
  <section class="viewer-page">
    <div class="viewer-bar">
      <button type="button" class="text-button" @click="emit('close')">← {{ t('roles.backToGames') }}</button>
      <span class="viewer-badge" role="status">
        {{ t('roles.viewing') }}<template v-if="match && match.scorerId && scorerName"> · {{ t('roles.scorerIs', { name: scorerName }) }}</template>
      </span>
    </div>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <p v-else-if="!game" class="statistics-hint" role="status">{{ t('statistics.loading') }}</p>
    <template v-if="game">
      <p v-if="!match?.scorerId && !match?.finishedAt" class="statistics-hint">{{ t('roles.noScorer') }}</p>
      <Scoreboard
        :teams="game.teams"
        :scores="scores"
        :score-notification="null"
        :game-started="game.gameStarted"
        :match-finished="!!match?.finishedAt"
        :can-start="false"
        :can-start-new-match="false"
        :period="game.period"
        :youth="game.youth ?? false"
        clock-display="00:00"
        :clock-running="false"
        :clock-available="false"
        :team-fouls="teamFouls"
        read-only
      />
      <section class="court-lineup panel viewer-lineup" :aria-label="t('roles.lineup')">
        <ul v-if="started && onCourt.length" class="court-lineup-players" tabindex="0">
          <li v-for="player in onCourt" :key="player.id">
            <span class="court-lineup-number">{{ player.jerseyNumber || '—' }}</span>
            <span>{{ displayPlayerName(player.name) }}</span>
            <FoulMarker :count="playerFouls[player.id] ?? 0" />
          </li>
        </ul>
        <p v-else class="statistics-hint">{{ t('roles.lineupEmpty') }}</p>
      </section>
      <p v-if="!hasActivity && !match?.finishedAt" class="statistics-hint" role="status">{{ t('roles.waiting') }}</p>
      <ActivityPanel
        :teams="game.teams"
        :recent-actions="recentActions"
        :timeline="game.timeline ?? []"
        :youth="game.youth ?? false"
        :team-stats="teamStats"
        :player-name="playerName"
        :can-undo="false"
        :player-fouls="playerFouls"
        read-only
        hide-stats
      />
    </template>
    <ThankYouOverlay v-if="endOpen" viewer :teams="endTeams" @done="endOpen = false" />
  </section>
</template>
