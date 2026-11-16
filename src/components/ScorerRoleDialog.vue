<script setup lang="ts">
import { ref } from 'vue'
import { useLocale } from '../i18n/useLocale'
import BaseDialog from './BaseDialog.vue'
import JoinSidePicker from './JoinSidePicker.vue'

defineProps<{
  homeName: string
  awayName: string
  // A viewer needs a session to follow; before anyone started the game there is nothing to watch yet.
  canWatch: boolean
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
    backdrop-class="match-dialog-backdrop"
    dialog-class="panel user-profile-dialog"
    labelledby="role-dialog-title"
    @close="emit('cancel')"
  >
    <div class="role-dialog">
      <h2 id="role-dialog-title">{{ t('roles.title') }}</h2>
      <p class="statistics-hint">{{ homeName }} – {{ awayName }}</p>

      <template v-if="step === 'choose'">
        <div class="role-options">
          <button type="button" class="role-option" :disabled="busy" @click="step = 'scorer'">
            <strong>{{ t('roles.scorerTitle') }}</strong>
            <span>{{ t('roles.scorerText') }}</span>
          </button>
          <button type="button" class="role-option" :disabled="busy || !canWatch" @click="emit('view')">
            <strong>{{ t('roles.viewerTitle') }}</strong>
            <span>{{ t(canWatch ? 'roles.viewerText' : 'roles.viewerUnavailable') }}</span>
          </button>
        </div>
        <button type="button" class="match-sync-secondary" @click="emit('cancel')">{{ t('sessions.cancelPick') }}</button>
      </template>

      <template v-else>
        <div class="role-disclaimer" role="note">
          <strong>{{ t('roles.disclaimerTitle') }}</strong>
          <p>{{ t('roles.disclaimer') }}</p>
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
