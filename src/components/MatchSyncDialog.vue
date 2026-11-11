<script setup lang="ts">
import { ref } from 'vue'
import { useLocale } from '../i18n/useLocale'
import type { MatchLink } from '../services/matchEventLog'

const props = defineProps<{
  configured: boolean
  matchLink: MatchLink | null
  status: 'local' | 'offline' | 'syncing' | 'synced' | 'error'
  error: string
  defaultDisplayName?: string
}>()

const emit = defineEmits<{
  close: []
  create: [displayName: string]
  join: [joinCode: string, displayName: string]
}>()

const { t } = useLocale()
const displayName = ref(props.defaultDisplayName?.trim() || t('sync.defaultName'))
const joinCode = ref('')

function createMatch() {
  if (!displayName.value.trim()) return
  emit('create', displayName.value.trim())
}

function joinMatch() {
  if (!displayName.value.trim() || !joinCode.value.trim()) return
  emit('join', joinCode.value.trim().toUpperCase(), displayName.value.trim())
}
</script>

<template>
  <div class="match-dialog-backdrop" @click.self="emit('close')">
    <section class="match-dialog panel" role="dialog" aria-modal="true" :aria-label="t('sync.title')">
      <header class="match-dialog-header">
        <div>
          <p class="eyebrow">{{ t('sync.eyebrow') }}</p>
          <h2>{{ t('sync.title') }}</h2>
        </div>
        <button class="match-dialog-close" type="button" :aria-label="t('picker.cancel')" @click="emit('close')">×</button>
      </header>
      <p class="match-dialog-description">{{ t('sync.description') }}</p>

      <p v-if="!configured" class="match-sync-message" role="status">{{ t('sync.notConfigured') }}</p>

      <div v-if="props.matchLink" class="shared-match-details">
        <span>{{ t('sync.activeMatch') }}</span>
        <strong class="shared-match-code">{{ props.matchLink.joinCode }}</strong>
        <span>{{ t('sync.tracker', { name: props.matchLink.displayName }) }}</span>
        <p class="match-sync-status" :class="`match-sync-status-${props.status}`">{{ t(`sync.status.${props.status}`) }}</p>
      </div>
      <template v-else>
        <label class="match-sync-field">
          <span>{{ t('sync.displayName') }}</span>
          <input v-model="displayName" type="text" maxlength="60" autocomplete="nickname" :placeholder="t('sync.defaultName')">
        </label>
        <form class="match-sync-form" @submit.prevent="createMatch">
          <button type="submit" class="match-sync-primary" :disabled="!configured || !displayName.trim()">{{ t('sync.create') }}</button>
        </form>

        <div class="match-sync-divider"><span>{{ t('sync.or') }}</span></div>
        <form class="match-sync-form" @submit.prevent="joinMatch">
          <label class="match-sync-field">
            <span>{{ t('sync.joinCode') }}</span>
            <input v-model="joinCode" type="text" inputmode="text" maxlength="12" autocomplete="off" autocapitalize="characters" :placeholder="t('sync.codePlaceholder')">
          </label>
          <button type="submit" class="match-sync-secondary" :disabled="!configured || !displayName.trim() || !joinCode.trim()">{{ t('sync.join') }}</button>
        </form>
      </template>

      <p v-if="props.error" class="match-sync-error" role="alert">{{ props.error }}</p>
      <p class="match-sync-footnote">{{ t('sync.offlineNote') }}</p>
    </section>
  </div>
</template>
