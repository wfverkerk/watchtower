<script setup lang="ts">
import PageHeader from './PageHeader.vue'
import { onMounted, ref } from 'vue'
import { errorMessage } from '../domain/guards'
import { fullTeamName, isPracticeGame } from '../domain/game'
import { useLocale } from '../i18n/useLocale'
import { listMatchSessions, type MatchSession } from '../services/sharedMatch'
import { loadLocalMatches, type LocalMatch } from '../services/localMatches'
import { addPracticeMatchToStatistics, submitLocalMatch } from '../services/submitLocalMatch'

const props = defineProps<{ configured: boolean; hasCurrentGame: boolean; displayName: string }>()
const emit = defineEmits<{ close: []; start: [] }>()
const { t } = useLocale()
const localMatches = ref<LocalMatch[]>([])
const sessions = ref<MatchSession[]>([])
const targets = ref<Record<string, string>>({})
const submitting = ref('')
const error = ref('')
const localError = ref('')
const statisticsErrors = ref<Record<string, string>>({})

function reloadLocalMatches() {
  try {
    localMatches.value = loadLocalMatches()
    localError.value = ''
  } catch (reason) {
    console.error('Failed to load local matches.', reason)
    localError.value = t('sessions.localLoadError')
  }
}

async function refreshSessions() {
  if (!props.configured || !navigator.onLine) return
  try {
    sessions.value = await listMatchSessions(true)
  } catch (reason) {
    console.error('Failed to load match sessions.', reason)
    error.value = `${t('sessions.loadError')}: ${errorMessage(reason)}`
  }
}

function matchingSessions(match: LocalMatch) {
  const startsAt = match.game.matchInfo?.startsAt
  if (!startsAt) return []
  const names = match.game.teams.map((team) => team.name.trim().toLocaleLowerCase()).sort()
  return sessions.value.filter((session) => Date.parse(session.startsAt) === Date.parse(startsAt)
    && session.teams.map((team) => team.name.trim().toLocaleLowerCase()).sort().every((name, index) => name === names[index]))
}

async function addToStatistics(match: LocalMatch) {
  delete statisticsErrors.value[match.id]
  try {
    await addPracticeMatchToStatistics(match.id)
  } catch (reason) {
    console.error('Failed to add the practice game to the statistics.', reason)
    statisticsErrors.value[match.id] = errorMessage(reason)
  }
  reloadLocalMatches()
}

async function submit(match: LocalMatch) {
  if (submitting.value) return
  submitting.value = match.id
  error.value = ''
  try {
    const target = isPracticeGame(match.game) ? 'new' : targets.value[match.id] || 'new'
    await submitLocalMatch(match.id, target === 'new' ? null : target, props.displayName)
    reloadLocalMatches()
    if (isPracticeGame(match.game)) await addToStatistics(match)
    await refreshSessions()
  } catch (reason) {
    console.error('Failed to submit local match.', reason)
    error.value = errorMessage(reason)
    reloadLocalMatches()
  } finally {
    submitting.value = ''
  }
}

async function retryStatistics(match: LocalMatch) {
  if (submitting.value) return
  submitting.value = match.id
  try {
    await addToStatistics(match)
  } finally {
    submitting.value = ''
  }
}

onMounted(() => {
  reloadLocalMatches()
  for (const match of localMatches.value) targets.value[match.id] = match.submission?.targetMatchId ?? 'new'
  void refreshSessions()
})
</script>

<template>
  <section class="sessions-page practice-page">
    <PageHeader :eyebrow="t('sessions.practiceEyebrow')" :title="t('sessions.practiceTitle')">
      <button class="match-sync-secondary" type="button" @click="emit('close')">{{ t('sessions.practiceBack') }}</button>
    </PageHeader>
    <p v-if="!configured" class="notice">{{ t('sync.notConfigured') }}</p>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <p v-if="localError" class="notice" role="alert">{{ localError }}</p>
    <section class="panel statistics-card practice-card">
      <h2>{{ t('sessions.practiceTitle') }}</h2>
      <p class="statistics-hint">{{ t('sessions.practiceHint') }}</p>
      <div class="session-actions">
        <button type="button" class="match-sync-primary" :disabled="hasCurrentGame" @click="emit('start')">{{ t('sessions.practiceStart') }}</button>
      </div>
      <p v-if="hasCurrentGame" class="statistics-hint">{{ t('sessions.finishFirst') }}</p>
    </section>
    <section class="panel statistics-card">
      <h2>{{ t('sessions.localFinished') }}</h2>
      <p v-if="!localMatches.length" class="statistics-hint">{{ t('sessions.localEmpty') }}</p>
      <div v-for="match in localMatches" :key="match.id" class="session-row">
        <strong>{{ fullTeamName(match.game.teams[0]) }} – {{ fullTeamName(match.game.teams[1]) }}</strong>
        <span>{{ match.game.matchInfo?.date }} {{ match.game.matchInfo?.startTime }}</span>
        <span v-if="isPracticeGame(match.game)" class="session-status practice-badge">{{ t('sessions.practiceBadge') }}</span>
        <template v-if="match.submission?.resultMatchId">
          <span class="statistics-hint">{{ t(match.submission.statisticsTeamId ? 'sessions.practiceInStatistics' : 'sessions.submitted') }}</span>
          <template v-if="isPracticeGame(match.game) && !match.submission.statisticsTeamId">
            <p v-if="statisticsErrors[match.id]" class="statistics-hint" role="alert">{{ statisticsErrors[match.id] }}</p>
            <p class="statistics-hint">{{ t('sessions.practiceStatisticsHint') }}</p>
            <button type="button" class="match-sync-secondary" :disabled="!configured || !!submitting" @click="retryStatistics(match)">{{ t('sessions.practiceAddToStatistics') }}</button>
          </template>
        </template>
        <template v-else>
          <label v-if="!isPracticeGame(match.game)" class="match-sync-field">{{ t('sessions.submitTarget') }}
            <select v-model="targets[match.id]" :disabled="!!match.submission || !configured">
              <option value="new">{{ t('sessions.submitNew') }}</option>
              <option v-for="session in matchingSessions(match)" :key="session.id" :value="session.id">
                {{ session.teams[0]?.name }} – {{ session.teams[1]?.name }} · {{ new Date(session.startsAt).toLocaleString() }}
              </option>
            </select>
          </label>
          <button type="button" class="match-sync-primary" :disabled="!configured || !!submitting || !match.game.matchInfo?.startsAt" @click="submit(match)">{{ t('sessions.submit') }}</button>
          <span v-if="!match.game.matchInfo?.startsAt" class="statistics-hint">{{ t('sessions.missingStart') }}</span>
        </template>
      </div>
    </section>
  </section>
</template>
