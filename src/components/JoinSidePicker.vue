<script setup lang="ts">
import { ref } from 'vue'
import { useLocale } from '../i18n/useLocale'
import TeamLogo from './TeamLogo.vue'
import AppButton from './ui/AppButton.vue'

defineProps<{ homeName: string; awayName: string }>()
const emit = defineEmits<{ confirm: [side: 'home' | 'away']; cancel: [] }>()
const { t } = useLocale()
const side = ref<'home' | 'away' | null>(null)
</script>

<template>
  <div class="join-side-picker mt-2 grid gap-2.5">
    <p class="statistics-hint">{{ t('sessions.pickSide') }}</p>
    <div class="join-side-options grid grid-cols-2 gap-3">
      <button
        v-for="option in (['home', 'away'] as const)"
        :key="option"
        type="button"
        class="join-side-option grid scale-100 justify-items-center gap-1.5 rounded-xl border-2 border-line bg-transparent p-2.5 text-inherit transition-[transform,opacity,border-color] duration-180 motion-reduce:transition-none [&_.team-logo]:size-14 [&.is-other]:opacity-55 [&.is-selected]:scale-112 [&.is-selected]:border-current"
        :class="{ 'is-selected': side === option, 'is-other': side !== null && side !== option }"
        :aria-pressed="side === option"
        @click="side = option"
      >
        <TeamLogo :name="option === 'home' ? homeName : awayName" placeholder />
        <strong>{{ option === 'home' ? homeName : awayName }}</strong>
      </button>
    </div>
    <div class="session-actions flex flex-wrap gap-2">
      <AppButton variant="primary" :disabled="!side" @click="side && emit('confirm', side)">{{ t('sessions.continue') }}</AppButton>
      <AppButton @click="emit('cancel')">{{ t('sessions.cancelPick') }}</AppButton>
    </div>
  </div>
</template>
