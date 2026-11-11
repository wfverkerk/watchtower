<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { appLocales, localeFlags, localeLabels, type AppLocale } from '../i18n/types'
import { useLocale } from '../i18n/useLocale'
import type { UserProfile } from '../services/userProfile'
import type { ZoebasTeam } from '../services/zoebasTeams'

const props = defineProps<{
  profile: UserProfile | null
  teams: ZoebasTeam[]
  error: string
}>()

const emit = defineEmits<{
  cancel: []
  save: [profile: UserProfile]
  localeChange: [locale: AppLocale]
}>()

const { t, locale } = useLocale()
const name = ref(props.profile?.name ?? '')
const description = ref(props.profile?.description ?? '')
const selectedLocale = ref<AppLocale>(props.profile?.locale ?? locale.value)
const databasePlayerNames = computed(() => [...new Set(props.teams.flatMap((team) => team.playerNames).filter(Boolean))])
const examplePlayerName = ref('')
const canSave = computed(() => name.value.trim().length > 0)

watch(databasePlayerNames, (playerNames) => {
  if (!examplePlayerName.value && playerNames.length) {
    examplePlayerName.value = playerNames[Math.floor(Math.random() * playerNames.length)]
  }
}, { immediate: true })

const descriptionPlaceholder = computed(() => examplePlayerName.value
  ? t('userProfile.descriptionPlaceholder', { playerName: examplePlayerName.value })
  : t('userProfile.descriptionPlaceholderFallback'))

function save() {
  if (!canSave.value) return
  emit('save', {
    name: name.value.trim(),
    description: description.value.trim(),
    locale: selectedLocale.value,
  })
}
</script>

<template>
  <div :class="profile ? 'match-dialog-backdrop' : 'user-profile-page'" @keydown.esc.window="profile && emit('cancel')">
    <section
      class="panel user-profile-dialog"
      :class="{ 'user-profile-modal': profile, 'user-profile-onboarding': !profile }"
      :role="profile ? 'dialog' : 'region'"
      :aria-modal="profile ? true : undefined"
      aria-labelledby="user-profile-title"
    >
      <header class="match-dialog-header">
        <div>
          <p class="eyebrow">{{ t('userProfile.eyebrow') }}</p>
          <h2 id="user-profile-title">{{ t(profile ? 'userProfile.editTitle' : 'userProfile.welcomeTitle') }}</h2>
        </div>
        <button v-if="profile" class="match-dialog-close" type="button" :aria-label="t('userProfile.cancel')" @click="emit('cancel')">×</button>
      </header>
      <p class="match-dialog-description">{{ t('userProfile.description') }}</p>
      <form class="user-profile-form" @submit.prevent="save">
        <label class="match-sync-field">
          <span>{{ t('userProfile.name') }}</span>
          <input v-model="name" type="text" maxlength="60" autocomplete="name" :placeholder="t('userProfile.namePlaceholder')">
        </label>

        <label class="match-sync-field">
          <span>{{ t('userProfile.descriptionLabel') }} <small>{{ t('userProfile.optional') }}</small></span>
          <input v-model="description" type="text" maxlength="120" :placeholder="descriptionPlaceholder">
        </label>

        <fieldset class="profile-language-options">
          <legend>{{ t('userProfile.language') }}</legend>
          <label v-for="language in appLocales" :key="language" class="profile-language-option">
            <input
              v-model="selectedLocale"
              class="visually-hidden"
              type="radio"
              name="profile-language"
              :value="language"
              @change="emit('localeChange', language)"
            >
            <span class="profile-language-flag" aria-hidden="true">{{ localeFlags[language] }}</span>
            <span>{{ localeLabels[language] }}</span>
          </label>
        </fieldset>

        <p v-if="error" class="match-sync-error" role="alert">{{ error }}</p>
        <footer class="user-profile-footer">
          <button v-if="profile" class="match-sync-secondary" type="button" @click="emit('cancel')">{{ t('userProfile.cancel') }}</button>
          <button class="match-sync-primary" type="submit" :disabled="!canSave">
            {{ t(profile ? 'userProfile.save' : 'userProfile.continue') }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>
