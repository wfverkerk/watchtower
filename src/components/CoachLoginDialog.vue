<script setup lang="ts">
import { errorMessage } from '../domain/guards'
import { onMounted, ref } from 'vue'
import { useLocale } from '../i18n/useLocale'
import { getSupabaseClient } from '../services/supabaseClient'
import BaseDialog from './BaseDialog.vue'
import DialogHeader from './DialogHeader.vue'
import AppButton from './ui/AppButton.vue'
import FormField from './ui/FormField.vue'

const props = defineProps<{ hasMatch: boolean; releaseMatch: () => Promise<void> }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useLocale()
const email = ref('')
const signedInEmail = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')

onMounted(async () => {
  try {
    const client = getSupabaseClient()
    if (!client) throw new Error(t('sync.notConfigured'))
    const result = await client.auth.getSession()
    if (result.error) throw result.error
    signedInEmail.value = result.data.session?.user.is_anonymous ? '' : result.data.session?.user.email ?? ''
  } catch (reason) {
    console.error('Failed to load coach account.', reason)
    error.value = errorMessage(reason)
  }
})

async function switchIdentity(action: 'login' | 'logout') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const client = getSupabaseClient()
    if (!client) throw new Error(t('sync.notConfigured'))
    if (props.hasMatch) {
      if (!window.confirm(t('statistics.leaveMatchConfirm'))) return
    }
    await props.releaseMatch()
    if (action === 'login') {
      const { error: authError } = await client.auth.signInWithOtp({
        email: email.value.trim(),
        options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href },
      })
      if (authError) throw authError
      message.value = t('statistics.emailSent')
    } else {
      const { error: authError } = await client.auth.signOut()
      if (authError) throw authError
      signedInEmail.value = ''
      message.value = t('statistics.signedOut')
    }
  } catch (reason) {
    console.error('Failed to switch coach account.', reason)
    error.value = errorMessage(reason)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseDialog :label="t('statistics.coachLogin')" close-on-backdrop @close="emit('close')">
    <DialogHeader :title="t('statistics.coachLogin')" :close-label="t('picker.cancel')" @close="emit('close')" />
    <p class="match-dialog-description">{{ t('statistics.coachAccessHint') }}</p>
    <template v-if="signedInEmail">
      <p>{{ t('statistics.signedIn', { email: signedInEmail }) }}</p>
      <AppButton :disabled="busy" @click="switchIdentity('logout')">{{ t('statistics.signOut') }}</AppButton>
    </template>
    <form v-else class="match-sync-form" @submit.prevent="switchIdentity('login')">
      <FormField>{{ t('statistics.email') }}
        <input v-model="email" type="email" required autocomplete="email">
      </FormField>
      <AppButton variant="primary" type="submit" :disabled="busy || !email.trim()">{{ t('statistics.sendLink') }}</AppButton>
    </form>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="error" class="match-sync-error" role="alert">{{ error }}</p>
  </BaseDialog>
</template>
