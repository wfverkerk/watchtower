<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { errorMessage } from '../domain/guards'
import { useLocale } from '../i18n/useLocale'
import { loadAdminDashboard, removeTeamCoach, setTeamCoach, type AdminCoach, type AdminTeam, type CoachRight } from '../services/admin'
import BaseDialog from './BaseDialog.vue'
import AppButton from './ui/AppButton.vue'
import DialogHeader from './DialogHeader.vue'

const emit = defineEmits<{ close: [] }>()
const { t } = useLocale()
const teams = ref<AdminTeam[]>([])
const query = ref('')
const error = ref('')
const busy = ref(false)
const newEmail = ref<Record<string, string>>({})
const newRights = ref<Record<string, CoachRight[]>>({})
const rightOptions: CoachRight[] = ['finalise_review', 'manage_coaches']
const visibleTeams = computed(() => {
  const search = query.value.trim().toLowerCase()
  return teams.value.filter((team) => team.name.toLowerCase().includes(search))
})

function toggleRight(rights: CoachRight[], right: CoachRight) {
  return rights.includes(right) ? rights.filter((item) => item !== right) : [...rights, right]
}

async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
    teams.value = await loadAdminDashboard()
  } catch (reason) {
    console.error('Admin action failed.', reason)
    error.value = errorMessage(reason)
  } finally {
    busy.value = false
  }
}

function saveRights(teamId: string, coach: AdminCoach, rights: CoachRight[]) {
  void run(() => setTeamCoach(teamId, coach.email, rights))
}

function removeCoach(teamId: string, coach: AdminCoach) {
  if (!window.confirm(t('admin.removeConfirm'))) return
  void run(() => removeTeamCoach(teamId, coach.userId))
}

function addCoach(teamId: string) {
  const email = (newEmail.value[teamId] ?? '').trim()
  if (!email) return
  void run(async () => {
    await setTeamCoach(teamId, email, newRights.value[teamId] ?? ['finalise_review'])
    newEmail.value[teamId] = ''
  })
}

onMounted(() => { void run(async () => {}) })
</script>

<template>
  <BaseDialog
    dialog-class="admin-dashboard"
    :label="t('admin.title')"
    close-on-backdrop
    @close="emit('close')"
  >
    <DialogHeader :title="t('admin.title')">
      <AppButton @click="emit('close')">{{ t('admin.close') }}</AppButton>
    </DialogHeader>
    <p class="match-dialog-description">{{ t('admin.hint') }}</p>
    <input v-model="query" class="admin-search" type="search" :placeholder="t('admin.search')" :aria-label="t('admin.search')">
    <p v-if="error" class="match-sync-error" role="alert">{{ error }}</p>
    <details v-for="team in visibleTeams" :key="team.id" class="admin-team">
      <summary>{{ team.name }} <small>{{ team.coaches.length }}</small></summary>
      <ul class="admin-coaches">
        <li v-for="coach in team.coaches" :key="coach.userId" class="admin-coach">
          <span>{{ coach.email }}</span>
          <label v-for="right in rightOptions" :key="right" class="admin-right">
            <input
              type="checkbox"
              :checked="coach.rights.includes(right)"
              :disabled="busy"
              @change="saveRights(team.id, coach, toggleRight(coach.rights, right))"
            >
            {{ t(`admin.right.${right}`) }}
          </label>
          <AppButton :disabled="busy" @click="removeCoach(team.id, coach)">{{ t('admin.remove') }}</AppButton>
        </li>
      </ul>
      <form class="admin-add" @submit.prevent="addCoach(team.id)">
        <input v-model="newEmail[team.id]" type="email" :placeholder="t('admin.email')" :aria-label="t('admin.email')">
        <label v-for="right in rightOptions" :key="right" class="admin-right">
          <input
            type="checkbox"
            :checked="(newRights[team.id] ?? ['finalise_review']).includes(right)"
            @change="newRights[team.id] = toggleRight(newRights[team.id] ?? ['finalise_review'], right)"
          >
          {{ t(`admin.right.${right}`) }}
        </label>
        <AppButton variant="primary" type="submit" :disabled="busy">{{ t('admin.add') }}</AppButton>
      </form>
    </details>
  </BaseDialog>
</template>
