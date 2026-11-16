<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useLocale } from '../i18n/useLocale'

const props = withDefaults(defineProps<{
  teams?: { id: string; name: string; points: number }[]
  duration?: number
}>(), { teams: () => [], duration: 6500 })
const emit = defineEmits<{ done: [] }>()
const { t, displayTeamName } = useLocale()

const root = ref<HTMLElement | null>(null)
const confetti = Array.from({ length: 22 }, (_, index) => ({
  left: `${(index * 37) % 100}%`,
  delay: `${1.5 + (index % 7) * 0.18}s`,
  fall: `${2.6 + (index % 5) * 0.4}s`,
  color: ['#f26a36', '#ffd166', '#ffffff', '#2f6fdb'][index % 4],
  turn: `${(index % 2 ? 1 : -1) * (180 + index * 23)}deg`,
}))
let timer: ReturnType<typeof setTimeout> | undefined
let finished = false
let previousOverflow = ''

function finish() {
  if (finished) return
  finished = true
  emit('done')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    finish()
  }
}

onMounted(() => {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKeydown)
  root.value?.focus()
  timer = setTimeout(finish, props.duration)
})
onUnmounted(() => {
  clearTimeout(timer)
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = previousOverflow
})
</script>

<template>
  <div ref="root" class="thanks-overlay" role="dialog" aria-modal="true" :aria-label="t('thanks.label')" tabindex="-1" @click="finish">
    <span v-for="(piece, index) in confetti" :key="index" class="thanks-confetti" aria-hidden="true"
      :style="{ left: piece.left, animationDelay: piece.delay, animationDuration: piece.fall, background: piece.color, '--turn': piece.turn }"></span>
    <div class="thanks-court" aria-hidden="true">
      <svg viewBox="0 0 200 260" class="thanks-hoop">
        <rect x="45" y="12" width="110" height="72" rx="6" class="thanks-board" />
        <rect x="80" y="44" width="40" height="30" rx="2" class="thanks-board-box" />
        <line x1="100" y1="84" x2="100" y2="100" class="thanks-arm" />
        <g class="thanks-ball">
          <circle cx="100" cy="105" r="17" class="thanks-ball-body" />
          <path d="M83 105h34M100 88v34M89 93q11 12 0 24M111 93q-11 12 0 24" class="thanks-ball-seams" />
        </g>
        <g class="thanks-net">
          <path d="M66 106 80 150M82 107 88 152M100 108v45M118 107 112 152M134 106 120 150M70 120h60M76 136h48" class="thanks-net-lines" />
          <path d="M80 150q20 8 40 0" class="thanks-net-lines" />
        </g>
        <ellipse cx="100" cy="105" rx="35" ry="7" class="thanks-rim" />
        <line x1="20" y1="250" x2="180" y2="250" class="thanks-floor" />
      </svg>
    </div>
    <div class="thanks-text">
      <p class="thanks-eyebrow">{{ t('thanks.label') }}</p>
      <h2>{{ t('thanks.title') }}</h2>
      <p>{{ t('thanks.subtitle') }}</p>
      <div v-if="teams.length === 2" class="thanks-score">
        <span>{{ t('thanks.finalScore') }}</span>
        <strong>{{ displayTeamName(teams[0]) }} {{ teams[0].points }} – {{ teams[1].points }} {{ displayTeamName(teams[1]) }}</strong>
      </div>
      <button type="button" class="thanks-skip" @click.stop="finish">{{ t('thanks.skip') }}</button>
    </div>
  </div>
</template>
