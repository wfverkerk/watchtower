<script setup lang="ts">
import { ref } from 'vue'
import { useLocale } from '../i18n/useLocale'
import BaseDialog from './BaseDialog.vue'
import JoinSidePicker from './JoinSidePicker.vue'
import AppButton from './ui/AppButton.vue'

defineProps<{
  homeName: string
  awayName: string
  busy?: boolean
}>()

const emit = defineEmits<{
  view: []
  scorer: [side: 'home' | 'away']
  cancel: []
}>()

const { t } = useLocale()
const step = ref<'choose' | 'scorer'>('choose')
</script>

<template>
  <BaseDialog
    dialog-class="user-profile-dialog"
    size="lg"
    labelledby="role-dialog-title"
    @close="emit('cancel')"
  >
    <div class="role-dialog grid gap-3">
      <h2 id="role-dialog-title" class="m-0 text-[19px]">{{ t('roles.title') }}</h2>
      <p class="statistics-hint">{{ homeName }} – {{ awayName }}</p>

      <template v-if="step === 'choose'">
        <p class="role-notice m-0 rounded-lg bg-[#f26a3618] px-2.5 py-2 text-[13px] font-semibold text-ink" role="status">{{ t('roles.noScorer') }}</p>
        <div class="role-options grid gap-2.5">
          <button type="button" class="role-option grid gap-1 rounded-xl border border-line bg-panel p-3.5 text-left text-ink not-disabled:active:border-orange disabled:cursor-not-allowed disabled:opacity-55" :disabled="busy" @click="step = 'scorer'">
            <strong class="text-base">{{ t('roles.scorerTitle') }}</strong>
            <span class="text-[13px] leading-[1.35] text-muted">{{ t('roles.scorerText') }}</span>
          </button>
          <button type="button" class="role-option grid gap-1 rounded-xl border border-line bg-panel p-3.5 text-left text-ink not-disabled:active:border-orange disabled:cursor-not-allowed disabled:opacity-55" :disabled="busy" @click="emit('view')">
            <strong class="text-base">{{ t('roles.viewerTitle') }}</strong>
            <span class="text-[13px] leading-[1.35] text-muted">{{ t('roles.viewerText') }}</span>
          </button>
        </div>
        <AppButton @click="emit('cancel')">{{ t('sessions.cancelPick') }}</AppButton>
      </template>

      <template v-else>
        <div class="role-disclaimer grid gap-1 rounded-[10px] border border-orange bg-[color-mix(in_srgb,var(--orange)_10%,var(--panel))] p-3">
          <strong>{{ t('roles.disclaimerTitle') }}</strong>
          <p class="m-0 text-[13px] leading-[1.4]">{{ t('roles.disclaimer') }}</p>
        </div>
        <JoinSidePicker
          :home-name="homeName"
          :away-name="awayName"
          @confirm="emit('scorer', $event)"
          @cancel="step = 'choose'"
        />
      </template>
    </div>
  </BaseDialog>
</template>
