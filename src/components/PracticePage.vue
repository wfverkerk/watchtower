<script setup lang="ts">
import PageHeader from './PageHeader.vue'
import AppButton from './ui/AppButton.vue'
import AppCard from './ui/AppCard.vue'
import AppNotice from './ui/AppNotice.vue'
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
  <section class="sessions-page practice-page grid gap-4 pb-8">
    <PageHeader :eyebrow="t('sessions.practiceEyebrow')" :title="t('sessions.practiceTitle')">
      <AppButton @click="emit('close')">{{ t('sessions.practiceBack') }}</AppButton>
    </PageHeader>
    <AppNotice v-if="!configured" tone="error">{{ t('sync.notConfigured') }}</AppNotice>
    <AppNotice v-if="error" tone="error" role="alert">{{ error }}</AppNotice>
    <AppNotice v-if="localError" tone="error" role="alert">{{ localError }}</AppNotice>
    <AppCard class="practice-card" :title="t('sessions.practiceTitle')">
      <p class="statistics-hint">{{ t('sessions.practiceHint') }}</p>
      <div class="session-actions flex flex-wrap gap-2">
        <AppButton variant="primary" :disabled="hasCurrentGame" @click="emit('start')">{{ t('sessions.practiceStart') }}</AppButton>
      </div>
      <p v-if="hasCurrentGame" class="statistics-hint">{{ t('sessions.finishFirst') }}</p>
    </AppCard>
    <AppCard :title="t('sessions.localFinished')">
      <p v-if="!localMatches.length" class="statistics-hint">{{ t('sessions.localEmpty') }}</p>
      <div v-for="match in localMatches" :key="match.id" class="session-row grid gap-1.5 border-t border-line py-3.5">
        <strong>{{ fullTeamName(match.game.teams[0]) }} – {{ fullTeamName(match.game.teams[1]) }}</strong>
        <span>{{ match.game.matchInfo?.date }} {{ match.game.matchInfo?.startTime }}</span>
        <span v-if="isPracticeGame(match.game)" class="session-status practice-badge justify-self-start rounded-full bg-line px-2.5 py-0.5 text-xs font-bold">{{ t('sessions.practiceBadge') }}</span>
        <template v-if="match.submission?.resultMatchId">
          <span class="statistics-hint">{{ t(match.submission.statisticsTeamId ? 'sessions.practiceInStatistics' : 'sessions.submitted') }}</span>
          <template v-if="isPracticeGame(match.game) && !match.submission.statisticsTeamId">
            <p v-if="statisticsErrors[match.id]" class="statistics-hint" role="alert">{{ statisticsErrors[match.id] }}</p>
            <p class="statistics-hint">{{ t('sessions.practiceStatisticsHint') }}</p>
            <AppButton :disabled="!configured || !!submitting" @click="retryStatistics(match)">{{ t('sessions.practiceAddToStatistics') }}</AppButton>
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
          <AppButton variant="primary" :disabled="!configured || !!submitting || !match.game.matchInfo?.startsAt" @click="submit(match)">{{ t('sessions.submit') }}</AppButton>
          <span v-if="!match.game.matchInfo?.startsAt" class="statistics-hint">{{ t('sessions.missingStart') }}</span>
        </template>
      </div>
    </AppCard>
  </section>
</template>
