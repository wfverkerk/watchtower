<script setup lang="ts">
import PageHeader from './PageHeader.vue'
import { errorMessage } from '../domain/guards'
import { computed, onMounted, ref, watch } from 'vue'
import { matchPlayerId, playerMatchStats, statKeys, sumPlayerStats, type PlayerStatKey } from '../domain/statistics'
import { useLocale } from '../i18n/useLocale'
import type { MatchLink } from '../services/matchEventLog'
import { isSupabaseConfigured } from '../services/supabaseClient'
import { setLiveMatchTracker } from '../services/sharedMatch'
import {
  finishStatisticsMatch, joinStatisticsTeam, linkStatisticsPlayer, loadMatchScorers, loadStatisticsHistory,
  loadStatisticsRoster, loadStatisticsTeams, saveStatisticsPlayer, selectOfficialScorer,
  type MatchScorers, type StatisticsMatch, type StatisticsPlayer, type StatisticsTeam,
} from '../services/statistics'

const props = defineProps<{ matchLink: MatchLink | null; syncStatus: string; currentTeamId?: string }>()
const emit = defineEmits<{ close: []; 'coach-login': []; finished: [] }>()
const { t } = useLocale()
const teams = ref<StatisticsTeam[]>([])
const teamId = ref('')
const code = ref('')
const roster = ref<StatisticsPlayer[]>([])
const history = ref<StatisticsMatch[]>([])
const selectedPlayerId = ref('')
const selectedMetric = ref<PlayerStatKey>('points')
const trendCount = ref(10)
const scorers = ref<MatchScorers | null>(null)
const scorerId = ref('')
const liveScorerId = ref('')
const busy = ref(false)
const error = ref('')
const editingPlayerId = ref<string | null>(null)
const playerName = ref('')
const playerNumber = ref('')
const playerPrivate = ref(false)
let request = 0
let scorerRefreshPending = false

const selectedTeam = computed(() => teams.value.find((team) => team.id === teamId.value))
const selectedPlayer = computed(() => roster.value.find((player) => player.id === selectedPlayerId.value))
const playerGames = computed(() => {
  if (!selectedPlayerId.value) return []
  return history.value.flatMap((match) => {
    const stats = playerMatchStats(match, selectedPlayerId.value, roster.value)
    return stats ? [{ match, stats }] : []
  })
})
const totals = computed(() => sumPlayerStats(playerGames.value.map((item) => item.stats)))
const trend = computed(() => [...playerGames.value].sort((a, b) => {
  const first = a.match.matchDate ?? a.match.finishedAt.slice(0, 10)
  const second = b.match.matchDate ?? b.match.finishedAt.slice(0, 10)
  return first.localeCompare(second) || a.match.finishedAt.localeCompare(b.match.finishedAt)
}).slice(-trendCount.value))
const maxTrend = computed(() => Math.max(1, ...trend.value.map((item) => item.stats[selectedMetric.value])))
const trendPoints = computed(() => trend.value.map((item, index) => {
  const x = trend.value.length === 1 ? 50 : 5 + index * 90 / (trend.value.length - 1)
  return `${x},${90 - item.stats[selectedMetric.value] * 80 / maxTrend.value}`
}).join(' '))

function displayPlayer(player: StatisticsPlayer) {
  return player.name || `#${player.jerseyNumber}`
}

function matchLabel(match: StatisticsMatch) {
  const date = match.matchDate || new Date(match.finishedAt).toLocaleDateString()
  return `${date} · ${match.game.teams.map((team) => team.name).join(' – ')}`
}

async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (reason) {
    console.error('Statistics operation failed.', reason)
    error.value = !isSupabaseConfigured() ? t('sync.notConfigured') : errorMessage(reason)
  } finally {
    busy.value = false
    if (scorerRefreshPending) {
      scorerRefreshPending = false
      void run(refreshScorers)
    }
  }
}

async function refreshTeams() {
  teams.value = await loadStatisticsTeams()
  if (!teams.value.some((team) => team.id === teamId.value)) {
    teamId.value = teams.value.find((team) => team.id === props.currentTeamId)?.id ?? teams.value[0]?.id ?? ''
  }
}

async function refreshScorers() {
  if (!props.matchLink) { scorers.value = null; return }
  scorers.value = await loadMatchScorers(props.matchLink.matchId)
  scorerId.value = scorers.value.officialTrackerId ?? scorers.value.liveTrackerId ?? props.matchLink.trackerId
  liveScorerId.value = scorers.value.liveTrackerId ?? ''
  if (scorers.value.finishedAt) emit('finished')
}

async function refreshTeam() {
  const current = teamId.value
  const token = ++request
  if (!current) { roster.value = []; history.value = []; return }
  const [players, matches] = await Promise.all([loadStatisticsRoster(current), loadStatisticsHistory(current)])
  if (token !== request) return
  roster.value = players
  history.value = matches
  if (!players.some((player) => player.id === selectedPlayerId.value)) selectedPlayerId.value = players[0]?.id ?? ''
}

onMounted(() => { void run(async () => { await refreshTeams(); await refreshTeam(); await refreshScorers() }) })
watch(teamId, () => { void run(refreshTeam) })
watch(() => props.matchLink?.matchId, () => {
  if (busy.value) scorerRefreshPending = true
  else void run(refreshScorers)
})
watch(() => props.syncStatus, (status) => {
  if (status !== 'synced' || !props.matchLink) return
  if (busy.value) scorerRefreshPending = true
  else void run(refreshScorers)
})

async function joinTeam() {
  await run(async () => {
    const joined = await joinStatisticsTeam(code.value)
    code.value = ''
    await refreshTeams()
    teamId.value = joined
    await refreshTeam()
  })
}

async function savePlayer() {
  await run(async () => {
    await saveStatisticsPlayer(teamId.value, editingPlayerId.value, playerName.value, playerNumber.value, playerPrivate.value)
    editingPlayerId.value = null
    playerName.value = ''
    playerNumber.value = ''
    playerPrivate.value = false
    await refreshTeam()
  })
}

function editPlayer(player: StatisticsPlayer) {
  editingPlayerId.value = player.id
  playerName.value = player.name ?? ''
  playerNumber.value = player.jerseyNumber
  playerPrivate.value = player.isPrivate
}

async function finishMatch() {
  const link = props.matchLink
  if (!link || !teamId.value || !scorerId.value) return
  const scorer = scorers.value?.scorers.find((item) => item.id === scorerId.value)
  if (!window.confirm(t('statistics.finishConfirm', { team: selectedTeam.value?.name ?? '', scorer: scorer?.name ?? '' }))) return
  await run(async () => {
    await finishStatisticsMatch(link.matchId, teamId.value, scorerId.value)
    await refreshScorers()
    await refreshTeam()
  })
}

async function changeScorer() {
  const link = props.matchLink
  if (!link || !scorerId.value) return
  await run(async () => {
    await selectOfficialScorer(link.matchId, scorerId.value)
    await refreshScorers()
    if (teamId.value) await refreshTeam()
  })
}

async function changeLiveScorer() {
  const link = props.matchLink
  if (!link || !liveScorerId.value) return
  if (!window.confirm(t('sessions.changeLiveConfirm'))) return
  await run(async () => {
    await setLiveMatchTracker(link.matchId, liveScorerId.value)
    await refreshScorers()
  })
}

async function updateLink(match: StatisticsMatch, localId: string, event: Event) {
  const select = event.target as HTMLSelectElement
  const value = select.value
  await run(async () => {
    await linkStatisticsPlayer(teamId.value, match.id, match.trackerId, localId, value || null)
    await refreshTeam()
  })
  const current = history.value.find((item) => item.id === match.id) ?? match
  select.value = matchPlayerId(current, localId, roster.value) ?? ''
}
</script>

<template>
  <section class="statistics-page">
    <PageHeader :eyebrow="t('statistics.eyebrow')" :title="t('statistics.title')">
      <button class="match-sync-secondary" type="button" @click="emit('close')">{{ t('statistics.back') }}</button>
    </PageHeader>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <p v-if="busy" class="statistics-hint" role="status">{{ t('statistics.loading') }}</p>
    <p v-if="!matchLink" class="statistics-hint">{{ t('statistics.shareFirst') }}</p>
    <section class="panel statistics-card">
      <h2>{{ t('statistics.teamAccess') }}</h2>
      <form class="statistics-inline" @submit.prevent="joinTeam">
        <label class="match-sync-field">{{ t('statistics.teamCode') }}
          <input v-model="code" maxlength="24" autocomplete="off" autocapitalize="characters">
        </label>
        <button class="match-sync-primary" type="submit" :disabled="busy || !code.trim()">{{ t('statistics.joinTeam') }}</button>
      </form>
      <p class="statistics-hint">{{ t('statistics.teamCodeHint') }}</p>
      <button type="button" class="match-sync-secondary" @click="emit('coach-login')">{{ t('statistics.coachLogin') }}</button>
      <label v-if="teams.length" class="match-sync-field statistics-team-select">{{ t('statistics.team') }}
        <select v-model="teamId" :disabled="busy"><option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option></select>
      </label>
    </section>

    <section v-if="matchLink && scorers" class="panel statistics-card">
      <h2>{{ t('statistics.currentMatch') }}</h2>
      <p class="statistics-hint">{{ t('statistics.scorerHint') }}</p>
      <template v-if="scorers.canManageLive">
        <label class="match-sync-field">{{ t('sessions.liveScorer') }}
          <select v-model="liveScorerId">
            <option v-for="scorer in scorers.scorers" :key="scorer.id" :value="scorer.id" :disabled="!scorer.updatedAt">{{ scorer.name }} · {{ scorer.updatedAt ? new Date(scorer.updatedAt).toLocaleString() : t('statistics.noSnapshot') }}</option>
          </select>
        </label>
        <button type="button" class="match-sync-secondary" :disabled="busy || !liveScorerId || liveScorerId === scorers.liveTrackerId" @click="changeLiveScorer">{{ t('sessions.setLiveScorer') }}</button>
      </template>
      <label class="match-sync-field">{{ t('statistics.officialScorer') }}
        <select v-model="scorerId">
          <option v-for="scorer in scorers.scorers" :key="scorer.id" :value="scorer.id" :disabled="!scorer.updatedAt">
            {{ scorer.name }} · {{ scorer.updatedAt ? new Date(scorer.updatedAt).toLocaleString() : t('statistics.noSnapshot') }}
          </option>
        </select>
      </label>
      <p v-if="scorers.finishedAt" class="statistics-hint">{{ t('statistics.finishedAt', { date: new Date(scorers.finishedAt).toLocaleString() }) }}</p>
      <button v-if="scorers.finishedAt" class="match-sync-primary" type="button" :disabled="busy || !scorerId" @click="changeScorer">{{ t('statistics.changeScorer') }}</button>
      <button v-else class="match-sync-primary" type="button" :disabled="busy || !teamId || (!!currentTeamId && teamId !== currentTeamId) || !scorers.scorers.some((scorer) => scorer.id === scorerId && scorer.updatedAt) || syncStatus !== 'synced'" @click="finishMatch">{{ t('statistics.finishMatch') }}</button>
      <p v-if="!scorers.finishedAt && currentTeamId && teamId && teamId !== currentTeamId" class="statistics-hint">{{ t('statistics.wrongTeam') }}</p>
      <p v-if="!scorers.finishedAt && syncStatus !== 'synced'" class="statistics-hint">{{ t('statistics.syncBeforeFinish') }}</p>
    </section>

    <template v-if="selectedTeam">
      <details v-if="selectedTeam.isCoach" class="panel statistics-card statistics-roster-editor">
        <summary>{{ t('statistics.manageRoster') }}</summary>
        <p class="statistics-hint">{{ t('statistics.privateHint') }}</p>
        <form class="statistics-player-form" @submit.prevent="savePlayer">
          <label class="match-sync-field">{{ t('statistics.playerName') }}<input v-model="playerName" maxlength="100" required></label>
          <label class="match-sync-field">{{ t('statistics.jersey') }}<input v-model="playerNumber" inputmode="numeric" pattern="[0-9]{1,2}" required></label>
          <label><input v-model="playerPrivate" type="checkbox"> {{ t('statistics.private') }}</label>
          <button class="match-sync-primary" type="submit" :disabled="busy">{{ t(editingPlayerId ? 'statistics.savePlayer' : 'statistics.addPlayer') }}</button>
          <button v-if="editingPlayerId" type="button" class="match-sync-secondary" @click="editingPlayerId = null; playerName = ''; playerNumber = ''; playerPrivate = false">{{ t('statistics.cancel') }}</button>
        </form>
        <ul class="statistics-roster">
          <li v-for="player in roster" :key="player.id">
            <span>#{{ player.jerseyNumber }} · {{ displayPlayer(player) }} <small v-if="player.isPrivate">{{ t('statistics.private') }}</small></span>
            <button type="button" class="text-button" @click="editPlayer(player)">{{ t('statistics.edit') }}</button>
          </li>
        </ul>
      </details>

      <section class="panel statistics-card">
        <h2>{{ t('statistics.players') }}</h2>
        <p v-if="!roster.length" class="statistics-hint">{{ t('statistics.emptyRoster') }}</p>
        <label v-else class="match-sync-field">{{ t('statistics.player') }}
          <select v-model="selectedPlayerId">
            <option v-for="player in roster" :key="player.id" :value="player.id">{{ displayPlayer(player) }} · #{{ player.jerseyNumber }}</option>
          </select>
        </label>
        <template v-if="selectedPlayer">
          <h3>{{ t('statistics.lifetime', { count: playerGames.length }) }}</h3>
          <div class="statistics-metrics">
            <div v-for="key in statKeys" :key="key"><strong>{{ totals[key] }}</strong><span>{{ t(`statistics.metric.${key}`) }}</span></div>
          </div>
          <h3>{{ t('statistics.trends') }}</h3>
          <label class="match-sync-field">{{ t('statistics.trendCount') }}
            <select v-model.number="trendCount">
              <option :value="5">5</option><option :value="10">10</option><option :value="20">20</option>
              <option :value="Number.MAX_SAFE_INTEGER">{{ t('statistics.allMatches') }}</option>
            </select>
          </label>
          <label class="match-sync-field">{{ t('statistics.metricLabel') }}
            <select v-model="selectedMetric"><option v-for="key in statKeys" :key="key" :value="key">{{ t(`statistics.metric.${key}`) }}</option></select>
          </label>
          <p v-if="!trend.length" class="statistics-hint">{{ t('statistics.noGames') }}</p>
          <template v-else>
            <svg class="statistics-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline :points="trendPoints" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
              <circle v-for="(point, index) in trendPoints.split(' ')" :key="index" :cx="point.split(',')[0]" :cy="point.split(',')[1]" r="1.5" />
            </svg>
            <ol class="statistics-trend-values">
              <li v-for="item in trend" :key="item.match.id">{{ matchLabel(item.match) }}: {{ item.stats[selectedMetric] }}</li>
            </ol>
          </template>
          <h3>{{ t('statistics.perMatch') }}</h3>
          <article v-for="item in playerGames" :key="item.match.id" class="statistics-match">
            <strong>{{ matchLabel(item.match) }}</strong>
            <div class="statistics-metrics">
              <div v-for="key in statKeys" :key="key"><strong>{{ item.stats[key] }}</strong><span>{{ t(`statistics.metric.${key}`) }}</span></div>
            </div>
          </article>
        </template>
      </section>

      <section class="panel statistics-card">
        <h2>{{ t('statistics.history') }}</h2>
        <p class="statistics-hint">{{ t('statistics.mappingHint') }}</p>
        <p v-if="!history.length" class="statistics-hint">{{ t('statistics.noHistory') }}</p>
        <article v-for="match in history" :key="match.id" class="statistics-match">
          <strong>{{ matchLabel(match) }}</strong>
          <p class="statistics-hint">{{ t('statistics.snapshotTime', { date: new Date(match.snapshotUpdatedAt).toLocaleString() }) }}</p>
          <div v-for="player in match.game.players.filter((p) => p.teamId === match.game.teams[0].id && !p.isCoach)" :key="player.id" class="statistics-link">
            <span>#{{ player.jerseyNumber || '—' }}</span>
            <select :value="matchPlayerId(match, player.id, roster) ?? ''" :disabled="!match.canEdit || busy" :aria-label="t('statistics.linkPlayer', { number: player.jerseyNumber })" @change="updateLink(match, player.id, $event)">
              <option value="">{{ t('statistics.unlinked') }}</option>
              <option v-for="person in roster" :key="person.id" :value="person.id"
                :disabled="match.game.players.some((other) => other.id !== player.id && matchPlayerId(match, other.id, roster) === person.id)">
                {{ displayPlayer(person) }} · #{{ person.jerseyNumber }}
              </option>
            </select>
          </div>
          <p v-if="!match.canEdit" class="statistics-hint">{{ t('statistics.matchMemberToLink') }}</p>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.statistics-roster-editor summary { cursor: pointer; font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 700; }
.statistics-roster-editor[open] summary { margin-bottom: 12px; }
.statistics-card h3 { margin: 22px 0 10px; font-size: 15px; }
.statistics-inline, .statistics-player-form { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; }
.statistics-player-form label { min-width: 90px; }
.statistics-team-select { margin-top: 16px; }
select { min-height: 39px; padding: 7px; border: 1px solid var(--line); border-radius: 7px; color: var(--ink); background: var(--panel); }
.statistics-roster { padding: 0; list-style: none; }
.statistics-roster li { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.statistics-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(75px, 1fr)); gap: 8px; }
.statistics-metrics div { display: grid; gap: 3px; padding: 10px; border-radius: 7px; background: var(--page); }
.statistics-metrics strong { font-size: 20px; }
.statistics-metrics span { color: var(--muted); font-size: 11px; }
.statistics-chart { width: 100%; height: 140px; margin-top: 12px; color: var(--orange); overflow: visible; }
.statistics-trend-values { padding-left: 20px; font-size: 12px; line-height: 1.7; }
.statistics-match { padding: 14px 0; border-top: 1px solid var(--line); }
.statistics-match .statistics-metrics { margin-top: 10px; }
.statistics-link { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.statistics-link select { flex: 1; min-width: 0; }
</style>
