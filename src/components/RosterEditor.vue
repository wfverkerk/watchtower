<script setup lang="ts">
import { computed } from 'vue'
import { useLocale } from '../i18n/useLocale'
import type { TeamProfile, TeamProfilePlayer } from '../services/teamProfiles'

const props = defineProps<{
  profile: TeamProfile
  disabled: boolean
  clearCourtOnAbsence: boolean
  showSharedJerseysHint: boolean
  error: string
}>()

const { t } = useLocale()
const participatingMembersCount = computed(() => props.profile.players.filter((player) => player.isParticipating).length)

function addPlayer() {
  props.profile.players.push({
    id: crypto.randomUUID(),
    name: '',
    jerseyNumber: '',
    isParticipating: true,
    isOnCourt: false,
  })
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
      <input v-model="player.name" type="text" :disabled="disabled || player.statisticsPrivate" :aria-label="t('teamSetup.playerName')" :placeholder="t('teamSetup.playerName')" maxlength="60">
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
  <p v-if="error" class="team-setup-error" role="alert">{{ error }}</p>
</template>
