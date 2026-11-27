<script setup lang="ts">
import TeamLogo from './TeamLogo.vue'

defineProps<{ team: string; club?: string | null; logoUrl?: string | null; position?: number | null }>()
</script>

<template>
  <div class="schedule-side grid min-w-0 justify-items-center gap-1.5 text-center [&_.team-logo]:size-14">
    <img v-if="logoUrl" class="team-logo size-14 flex-none rounded object-contain" :src="logoUrl" alt="" loading="lazy">
    <TeamLogo v-else :name="club || team" placeholder />
    <div class="schedule-names grid min-w-0 justify-items-center leading-[1.2] break-anywhere [&_span]:text-[0.85em] [&_span]:opacity-75">
      <span v-if="club && club !== team" class="schedule-name-line"><strong>{{ club }}</strong></span>
      <span class="schedule-name-line"><strong v-if="!club || club === team">{{ team }}</strong><template v-else>{{ team }}</template><span v-if="position" class="schedule-position ml-[0.35em] font-normal text-[color-mix(in_srgb,currentColor_50%,transparent)]">({{ position }})</span></span>
    </div>
  </div>
</template>
