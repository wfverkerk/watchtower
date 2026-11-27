<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpponentTeams } from '../composables/useOpponentTeams'
import { findOpponentTeam, opponentLogoUrl, type OpponentTeam } from '../services/opponentTeams'

const props = defineProps<{ name: string; teams?: OpponentTeam[]; placeholder?: boolean }>()
const { teams: sharedTeams } = useOpponentTeams()
const failedSource = ref<string | null>(null)

const source = computed(() => {
  const team = findOpponentTeam(props.teams ?? sharedTeams.value, props.name)
  const url = team ? opponentLogoUrl(team) : null
  return url && url !== failedSource.value ? url : null
})
</script>

<template>
  <img v-if="source" class="team-logo size-7 flex-none rounded object-contain" :src="source" alt="" loading="lazy" @error="failedSource = source">
  <span v-else-if="placeholder" class="team-logo team-logo-empty size-7 flex-none rounded bg-page" aria-hidden="true"></span>
</template>
