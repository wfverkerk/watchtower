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
  <div class="team-setup-roster-heading mt-4 flex items-center justify-between gap-2">
    <h3 class="m-0 text-[13px] text-[#6f6d67]">{{ t('teamSetup.players') }}</h3>
    <span class="text-[10px] text-[#85827b]">{{ t('teamSetup.participantCount', { count: participatingMembersCount }) }}</span>
  </div>
  <p class="team-setup-hint mt-1 mb-[9px] text-[10px] leading-[1.4] text-[#85827b]">{{ t('teamSetup.participantHint') }}</p>
  <p v-if="showSharedJerseysHint" class="team-setup-hint mt-1 mb-[9px] text-[10px] leading-[1.4] text-[#85827b]">{{ t('teamSetup.sharedJerseysHint') }}</p>
  <div class="team-setup-player team-setup-column-heading mb-[5px] grid grid-cols-[54px_minmax(0,1fr)_76px] gap-1.5 text-[10px] font-semibold text-muted max-xs:grid-cols-[44px_minmax(0,1fr)_76px] max-xs:gap-1 [&>span:first-child]:text-center [&>span:last-child]:text-center" aria-hidden="true">
    <span>#</span><span>{{ t('teamSetup.name') }}</span><span>{{ t('teamSetup.present') }}</span>
  </div>
  <div class="team-setup-roster grid gap-1.5">
    <div v-for="player in profile.players" :key="player.id" class="team-setup-player grid grid-cols-[54px_minmax(0,1fr)_76px] gap-1.5 max-xs:grid-cols-[44px_minmax(0,1fr)_76px] max-xs:gap-1 [&_input]:w-full">
      <input v-model="player.jerseyNumber" class="team-setup-jersey-input text-center" type="text" inputmode="numeric" maxlength="2" :disabled="disabled" :aria-label="t('teamSetup.jerseyNumber')" placeholder="#" @input="player.jerseyNumber = player.jerseyNumber.replace(/\D/g, '').slice(0, 2)">
      <input v-model="player.name" type="text" :disabled="disabled || player.statisticsPrivate" :aria-label="t('teamSetup.playerName')" :placeholder="t('teamSetup.playerName')" maxlength="60">
      <button
        class="team-setup-court-toggle flex min-h-9 w-[76px] items-stretch justify-self-center rounded-md border border-line bg-white p-0.5 text-[10px] text-[#77756e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange dark:bg-control dark:text-muted [&>span]:grid [&>span]:flex-1 [&>span]:place-items-center [&>span]:rounded [&[aria-pressed=false]>span:first-child]:bg-[#e8e9e7] [&[aria-pressed=false]>span:first-child]:font-bold [&[aria-pressed=false]>span:first-child]:text-[#4f514f] [&[aria-pressed=true]>span:last-child]:bg-[#e4f3e7] [&[aria-pressed=true]>span:last-child]:font-bold [&[aria-pressed=true]>span:last-child]:text-[#397f4c]"
        type="button"
        :disabled="disabled"
        :aria-pressed="player.isParticipating"
        :aria-label="t('teamSetup.participation', { name: player.name || t('teamSetup.playerName') })"
        :title="t(player.isParticipating ? 'teamSetup.present' : 'teamSetup.absent')"
        @click="toggleParticipation(player)"
      ><span aria-hidden="true">{{ t('teamSetup.no') }}</span><span aria-hidden="true">{{ t('teamSetup.yes') }}</span></button>
    </div>
  </div>
  <button class="team-setup-add-player mt-2 min-h-[37px] w-full rounded-md border border-line bg-white px-2.5 text-[11px] font-semibold whitespace-nowrap text-[#5f5d57]" type="button" :disabled="disabled" @click="addPlayer">+ {{ t('teamSetup.addPlayer') }}</button>
  <p v-if="error" class="team-setup-error mt-2 text-[11px] text-[#b9472c]" role="alert">{{ error }}</p>
</template>
