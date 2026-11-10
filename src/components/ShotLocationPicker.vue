<script setup lang="ts">
import { useLocale } from '../i18n/useLocale'
import type { ShotLocation } from '../domain/game'

const props = defineProps<{
  location: ShotLocation | null
}>()

const emit = defineEmits<{
  'update:location': [location: ShotLocation]
}>()

const { t } = useLocale()

function selectOpponentSpot(event: MouseEvent) {
  if (event.detail === 0) {
    emit('update:location', { area: 'opponent', x: 50, y: 50 })
    return
  }

  const bounds = (event.currentTarget as HTMLButtonElement).getBoundingClientRect()
  const x = Math.round(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)))
  const y = Math.round(Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)))
  emit('update:location', { area: 'opponent', x, y })
}

function moveOpponentSpot(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('update:location', { area: 'opponent', x: 50, y: 50 })
    return
  }

  const changes = {
    ArrowLeft: [-5, 0],
    ArrowRight: [5, 0],
    ArrowUp: [0, -5],
    ArrowDown: [0, 5],
  } as const
  const change = changes[event.key as keyof typeof changes]
  if (!change) return

  event.preventDefault()
  const x = props.location?.area === 'opponent' ? props.location.x : 50
  const y = props.location?.area === 'opponent' ? props.location.y : 50
  emit('update:location', {
    area: 'opponent',
    x: Math.max(0, Math.min(100, x + change[0])),
    y: Math.max(0, Math.min(100, y + change[1])),
  })
}
</script>

<template>
  <section class="shot-location-picker" :aria-label="t('picker.shotLocation')">
    <h3>{{ t('picker.shotLocation') }}</h3>
    <div class="shot-court-board">
      <button
        class="opponent-court"
        type="button"
        :aria-label="t('picker.opponentCourt')"
        aria-describedby="shot-location-hint"
        @click="selectOpponentSpot"
        @keydown="moveOpponentSpot"
      >
        <svg viewBox="0 0 300 232" aria-hidden="true">
          <rect class="court-floor" x="3" y="3" width="294" height="226" rx="4" />
          <rect class="court-outline" x="15" y="10" width="270" height="200" />
          <rect class="court-own-half" x="16" y="211" width="268" height="17" />
          <path class="court-line" d="M 35 10 V 76 C 35 139, 86 166, 150 166 C 214 166, 265 139, 265 76 V 10" />
          <rect class="court-line" x="104" y="10" width="92" height="85" />
          <circle class="court-line" cx="150" cy="95" r="30" />
          <path class="court-restricted" d="M 138 37 A 12 12 0 0 0 162 37" />
          <circle class="court-line" cx="150" cy="29" r="7" />
          <path class="court-backboard" d="M 132 17 H 168" />
          <path class="court-midline" d="M 15 210 H 285" />
          <circle
            v-if="location?.area === 'opponent'"
            class="court-shot-marker"
            :cx="15 + location.x * 2.7"
            :cy="10 + location.y * 2"
            r="6"
          />
        </svg>
      </button>
      <button
        class="backcourt-strip"
        :class="{ selected: location?.area === 'own' }"
        type="button"
        :aria-pressed="location?.area === 'own'"
        aria-describedby="shot-location-hint"
        @click="emit('update:location', { area: 'own' })"
      >{{ t('picker.backcourt') }}</button>
    </div>
    <p id="shot-location-hint" class="shot-location-hint">
      {{ location?.area === 'own' ? t('picker.backcourtSelected') : location?.area === 'opponent' ? t('picker.locationSelected', { x: location.x, y: location.y }) : t('picker.courtInstruction') }}
    </p>
  </section>
</template>
