<script setup lang="ts">
import TeamLogo from './TeamLogo.vue'

defineProps<{ team: string; club?: string | null; logoUrl?: string | null; position?: number | null }>()
</script>

<template>
  <div class="schedule-side">
    <img v-if="logoUrl" class="team-logo" :src="logoUrl" alt="" loading="lazy">
    <TeamLogo v-else :name="club || team" placeholder />
    <div class="schedule-names">
      <span class="schedule-name-line"><strong>{{ club || team }}</strong><span v-if="position" class="schedule-position">({{ position }})</span></span>
      <span v-if="club && club !== team">{{ team }}</span>
    </div>
  </div>
</template>
