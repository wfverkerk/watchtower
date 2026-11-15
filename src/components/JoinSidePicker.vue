<script setup lang="ts">
import { ref } from 'vue'
import { useLocale } from '../i18n/useLocale'
import TeamLogo from './TeamLogo.vue'

defineProps<{ homeName: string; awayName: string }>()
const emit = defineEmits<{ confirm: [side: 'home' | 'away']; cancel: [] }>()
const { t } = useLocale()
const side = ref<'home' | 'away' | null>(null)
</script>

<template>
  <div class="join-side-picker">
    <p class="statistics-hint">{{ t('sessions.pickSide') }}</p>
    <div class="join-side-options">
      <button
        v-for="option in (['home', 'away'] as const)"
        :key="option"
        type="button"
        class="join-side-option"
        :class="{ 'is-selected': side === option, 'is-other': side !== null && side !== option }"
        :aria-pressed="side === option"
        @click="side = option"
      >
        <TeamLogo :name="option === 'home' ? homeName : awayName" placeholder />
        <strong>{{ option === 'home' ? homeName : awayName }}</strong>
      </button>
    </div>
    <div class="session-actions">
      <button type="button" class="match-sync-primary" :disabled="!side" @click="side && emit('confirm', side)">{{ t('sessions.continue') }}</button>
      <button type="button" class="match-sync-secondary" @click="emit('cancel')">{{ t('sessions.cancelPick') }}</button>
    </div>
  </div>
</template>
