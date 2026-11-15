<script setup lang="ts">
import { errorMessage } from '../domain/guards'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getScore, personalFoulNumbers, type GameAction, type GameState } from '../domain/game'
import { isScoreCandidate, reconcileLiveScores } from '../domain/liveReconciliation'
import { getActionTranslation } from '../i18n/actionLabel'
import { isAppLocale, useLocale } from '../i18n/useLocale'
import { currentLiveActions, loadLiveMatch, setLiveScoreLink, watchLiveMatch, type LiveAction, type LiveMatch } from '../services/liveMatch'

const props = defineProps<{ matchId: string; initialGame: GameState; embedded?: boolean }>()
const { t, locale } = useLocale()
const live = ref<LiveMatch | null>(null)
const error = ref('')
const linkBusy = ref(false)
let stop: (() => void) | undefined
let unmounted = false
const offline = ref(!navigator.onLine)
function updateOnline() { offline.value = !navigator.onLine }
const actions = computed(() => live.value ? currentLiveActions(props.initialGame, live.value) : [])
const personalNumbers = computed(() => personalFoulNumbers(actions.value.map((item) => item.action)))
const reconciled = computed(() => live.value
  ? reconcileLiveScores(props.initialGame, live.value.sourceId, actions.value, live.value.links)
  : { official: [], additional: [], invalidLinks: [] })
const remoteScores = computed(() => actions.value.filter((item) => item.trackerId !== live.value?.sourceId && item.action.type === 'score'))
const scores = computed(() => getScore({
  ...props.initialGame,
  actions: reconciled.value.official.map((item) => item.action),
}))

const teamName = (teamId: string) => props.initialGame.teams.find((team) => team.id === teamId)?.name
const playerLabel = (playerId: string | null) => props.initialGame.players.find((player) => player.id === playerId)?.name ?? t('app.unknownPlayer')
function actionText(action: GameAction) {
  const translation = getActionTranslation(action, isAppLocale(locale.value) ? locale.value : 'nl', personalNumbers.value.get(action.id))
  return t(translation.key, translation.params ?? {})
}

function scoreLinkValue(item: LiveAction) {
  const link = live.value?.links.find((entry) => entry.sourceId === live.value?.sourceId
    && entry.contributorId === item.trackerId && entry.contributorActionId === item.action.id)
  return link?.mode === 'linked' ? link.sourceActionId ?? 'auto' : link?.mode ?? 'auto'
}

async function changeScoreLink(item: LiveAction, event: Event) {
  const select = event.target as HTMLSelectElement
  const sourceId = live.value?.sourceId
  if (!sourceId || linkBusy.value) return
  linkBusy.value = true
  try {
    await setLiveScoreLink(props.matchId, sourceId, item.trackerId, item.action.id, select.value)
    live.value = await loadLiveMatch(props.matchId)
    error.value = ''
  } catch (reason) {
    console.error('Failed to update score link.', reason)
    error.value = errorMessage(reason)
  } finally {
    select.value = scoreLinkValue(item)
    linkBusy.value = false
  }
}

onMounted(async () => {
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
  try {
    const cleanup = await watchLiveMatch(props.matchId, (value) => { live.value = value }, (message) => { error.value = message })
    if (unmounted) cleanup()
    else stop = cleanup
  } catch (reason) {
    console.error('Failed to follow live match.', reason)
    error.value = errorMessage(reason)
  }
})
onUnmounted(() => {
  unmounted = true
  stop?.()
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})
</script>

<template>
  <section class="sessions-page">
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <p v-if="offline" class="notice" role="status">{{ t('sessions.liveOffline') }}</p>
    <p v-if="!live && !error" class="statistics-hint" role="status">{{ t('statistics.loading') }}</p>
    <section v-if="live" class="panel statistics-card">
      <h2 v-if="embedded">{{ t('sessions.live') }}</h2>
      <div class="live-score">
        <strong>{{ initialGame.teams[0].name }}</strong>
        <b>{{ scores[0]?.points ?? 0 }} – {{ scores[1]?.points ?? 0 }}</b>
        <strong>{{ initialGame.teams[1].name }}</strong>
      </div>
      <p class="statistics-hint">{{ t('sessions.sourceScore') }}</p>
    </section>
    <section v-if="live" class="panel statistics-card">
      <h2>{{ t('activity.recent') }}</h2>
      <p class="statistics-hint">{{ t('sessions.independentActions') }}</p>
      <p v-if="reconciled.invalidLinks.length" class="notice" role="alert">{{ t('sessions.invalidLink') }}</p>
      <div v-for="item in [...reconciled.official].reverse()" :key="`${item.trackerId}:${item.action.id}`" class="session-row">
        <strong>{{ teamName(item.action.teamId) }}</strong>
        <span v-if="item.action.playerId">{{ playerLabel(item.action.playerId) }}</span>
        <span>{{ actionText(item.action) }}</span>
        <span>{{ item.trackerName || t('sessions.source') }} · {{ new Date(item.action.createdAt).toLocaleTimeString() }}</span>
        <span v-if="item.contributors.length" class="statistics-hint">{{ t(item.uncertain ? 'sessions.possibleMatch' : 'sessions.matched', { names: item.contributors.join(', ') }) }}</span>
      </div>
      <h3 v-if="reconciled.additional.length">{{ t('sessions.additional') }}</h3>
      <div v-for="item in [...reconciled.additional].reverse()" :key="`${item.trackerId}:${item.action.id}`" class="session-row">
        <strong>{{ teamName(item.action.teamId) }}</strong>
        <span>{{ actionText(item.action) }}</span>
        <span>{{ item.trackerName }} · {{ new Date(item.action.createdAt).toLocaleTimeString() }}</span>
      </div>
      <details v-if="embedded && remoteScores.length">
        <summary>{{ t('sessions.correctLinks') }}</summary>
        <label v-for="item in remoteScores" :key="`${item.trackerId}:${item.action.id}`" class="match-sync-field session-row">
          <span>{{ item.trackerName }} · {{ teamName(item.action.teamId) }} · {{ item.action.value }} · {{ new Date(item.action.createdAt).toLocaleTimeString() }}</span>
          <select :value="scoreLinkValue(item)" :disabled="linkBusy" @change="changeScoreLink(item, $event)">
            <option value="auto">{{ t('sessions.autoLink') }}</option>
            <option value="separate">{{ t('sessions.separateLink') }}</option>
            <option v-for="candidate in reconciled.official.filter((entry) => isScoreCandidate(entry.action, item.action))" :key="candidate.action.id" :value="candidate.action.id">
              {{ new Date(candidate.action.createdAt).toLocaleTimeString() }} · {{ candidate.action.value }}
            </option>
          </select>
        </label>
      </details>
    </section>
  </section>
</template>
