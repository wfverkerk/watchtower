<script setup lang="ts">
import { useLocale } from '../i18n/useLocale'

defineProps<{ count: number }>()
const { t } = useLocale()
</script>

<template>
  <span v-if="count >= 5" class="foul-marker" role="img" :aria-label="t('scoreboard.playerFoulLimit')" :title="t('scoreboard.playerFoulLimit')"></span>
</template>
