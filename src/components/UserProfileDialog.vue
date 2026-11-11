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
  theme: 'light' | 'dark'
}>()

const emit = defineEmits<{
  cancel: []
  save: [profile: UserProfile]
  localeChange: [locale: AppLocale]
  themeChange: [theme: 'light' | 'dark']
  reset: []
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
          <h2 id="user-profile-title">{{ t(profile ? 'userProfile.editTitle' : 'userProfile.welcomeTitle') }}</h2>
        </div>
        <button v-if="profile" class="match-dialog-close" type="button" :aria-label="t('userProfile.cancel')" @click="emit('cancel')">×</button>
      </header>
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

        <fieldset class="profile-language-options">
          <legend>{{ t('userProfile.appearance') }}</legend>
          <label v-for="option in (['light', 'dark'] as const)" :key="option" class="profile-language-option">
            <input
              class="visually-hidden"
              type="radio"
              name="profile-theme"
              :value="option"
              :checked="theme === option"
              @change="emit('themeChange', option)"
            >
            <svg v-if="option === 'light'" class="profile-theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
            </svg>
            <svg v-else class="profile-theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
            </svg>
            <span>{{ t(option === 'light' ? 'userProfile.light' : 'userProfile.dark') }}</span>
          </label>
        </fieldset>

        <p v-if="error" class="match-sync-error" role="alert">{{ error }}</p>
        <button v-if="profile" class="user-profile-reset" type="button" @click="emit('reset')">{{ t('userProfile.reset') }}</button>
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
