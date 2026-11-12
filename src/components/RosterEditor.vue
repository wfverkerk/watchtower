<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLocale } from '../i18n/useLocale'
import type { TeamProfile, TeamProfileCoach, TeamProfilePlayer } from '../services/teamProfiles'

const props = defineProps<{
  profile: TeamProfile
  disabled: boolean
  clearCourtOnAbsence: boolean
  showSharedJerseysHint: boolean
  error: string
}>()

const { t } = useLocale()
const newCoachName = ref('')
const newCoachRole = ref<TeamProfileCoach['role']>('coach')
const participatingCoaches = computed(() => props.profile.coaches.filter((coach) => coach.isParticipating).length)
const participatingMembersCount = computed(() =>
  props.profile.players.filter((player) => player.isParticipating).length + participatingCoaches.value,
)

function addPlayer() {
  props.profile.players.push({
    id: crypto.randomUUID(),
    name: '',
    jerseyNumber: '',
    isParticipating: true,
    isOnCourt: false,
  })
}

function addCoach() {
  const name = newCoachName.value.trim()
  if (!name) return
  props.profile.coaches.push({
    id: crypto.randomUUID(),
    name,
    role: newCoachRole.value,
    isParticipating: true,
  })
  newCoachName.value = ''
}

function toggleParticipation(player: TeamProfilePlayer) {
  player.isParticipating = !player.isParticipating
  if (!player.isParticipating && props.clearCourtOnAbsence) player.isOnCourt = false
}
</script>

<template>
  <div class="team-setup-roster-heading">
    <h3>{{ t('teamSetup.players') }}</h3>
    <span>{{ t('teamSetup.participantCount', { count: participatingMembersCount }) }}</span>
  </div>
  <p class="team-setup-hint">{{ t('teamSetup.participantHint') }}</p>
  <p v-if="showSharedJerseysHint" class="team-setup-hint">{{ t('teamSetup.sharedJerseysHint') }}</p>
  <div class="team-setup-player team-setup-column-heading" aria-hidden="true">
    <span>#</span><span>{{ t('teamSetup.name') }}</span><span>{{ t('teamSetup.present') }}</span>
  </div>
  <div class="team-setup-roster">
    <div v-for="player in profile.players" :key="player.id" class="team-setup-player">
      <input v-model="player.jerseyNumber" class="team-setup-jersey-input" type="text" inputmode="numeric" maxlength="2" :disabled="disabled" :aria-label="t('teamSetup.jerseyNumber')" placeholder="#" @input="player.jerseyNumber = player.jerseyNumber.replace(/\D/g, '').slice(0, 2)">
      <input v-model="player.name" type="text" :disabled="disabled" :aria-label="t('teamSetup.playerName')" :placeholder="t('teamSetup.playerName')" maxlength="60">
      <button
        class="team-setup-court-toggle"
        type="button"
        :disabled="disabled"
        :aria-pressed="player.isParticipating"
        :aria-label="t('teamSetup.participation', { name: player.name || t('teamSetup.playerName') })"
        :title="t(player.isParticipating ? 'teamSetup.present' : 'teamSetup.absent')"
        @click="toggleParticipation(player)"
      ><span aria-hidden="true">{{ t('teamSetup.no') }}</span><span aria-hidden="true">{{ t('teamSetup.yes') }}</span></button>
    </div>
  </div>
  <button class="team-setup-add-player" type="button" :disabled="disabled" @click="addPlayer">+ {{ t('teamSetup.addPlayer') }}</button>
  <section class="team-setup-coaches" :aria-label="t('teamSetup.coaches')">
    <div class="team-setup-roster-heading">
      <h3>{{ t('teamSetup.coaches') }}</h3>
      <span>{{ t('teamSetup.coachesSelected', { count: participatingCoaches }) }}</span>
    </div>
    <div v-if="profile.coaches.length" class="team-setup-player team-setup-column-heading" aria-hidden="true">
      <span class="team-setup-coach-name">{{ t('teamSetup.name') }}</span><span>{{ t('teamSetup.present') }}</span>
    </div>
    <div class="team-setup-roster">
      <div v-for="coach in profile.coaches" :key="coach.id" class="team-setup-player team-setup-coach">
        <span class="team-setup-coach-name">{{ coach.name }} <small>{{ t(coach.role === 'assistant' ? 'teamSetup.assistantCoach' : 'teamSetup.coach') }}</small></span>
        <button
          class="team-setup-court-toggle"
          type="button"
          :disabled="disabled"
          :aria-pressed="coach.isParticipating"
          :aria-label="t('teamSetup.participation', { name: coach.name })"
          :title="t(coach.isParticipating ? 'teamSetup.present' : 'teamSetup.absent')"
          @click="coach.isParticipating = !coach.isParticipating"
        ><span aria-hidden="true">{{ t('teamSetup.no') }}</span><span aria-hidden="true">{{ t('teamSetup.yes') }}</span></button>
      </div>
    </div>
    <form class="team-setup-add-coach" @submit.prevent="addCoach">
      <input v-model="newCoachName" type="text" :disabled="disabled" :aria-label="t('teamSetup.coachName')" :placeholder="t('teamSetup.coachName')" maxlength="60">
      <select v-model="newCoachRole" :disabled="disabled" :aria-label="t('teamSetup.coachRole')">
        <option value="coach">{{ t('teamSetup.coach') }}</option>
        <option value="assistant">{{ t('teamSetup.assistantCoach') }}</option>
      </select>
      <button class="team-setup-add-player" type="submit" :disabled="disabled || !newCoachName.trim()">+ {{ t('teamSetup.addCoachButton') }}</button>
    </form>
  </section>
  <p v-if="error" class="team-setup-error" role="alert">{{ error }}</p>
</template>
