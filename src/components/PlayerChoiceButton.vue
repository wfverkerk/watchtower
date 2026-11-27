<script setup lang="ts">
import type { Player } from '../domain/game'
import { useLocale } from '../i18n/useLocale'
import FoulMarker from './FoulMarker.vue'

defineProps<{
  player: Player
  foulCount: number
  noAssist?: boolean
}>()

const { t, displayPlayerName } = useLocale()
</script>

<template>
  <button type="button" class="player-choice picker-player flex min-h-11 min-w-0 flex-1 items-center gap-0 rounded-[6px] border border-line bg-white py-0 pr-1.5 pl-0 text-left text-[#55534d] hover:border-[#d9d5cd] hover:bg-[#fcfbf9] disabled:cursor-not-allowed disabled:opacity-50 [&.selected]:border-[#f0c4ae] [&.selected]:bg-[#fff8f4]">
    <span v-if="!noAssist" class="jersey-number grid h-auto w-[30px] flex-[0_0_30px] self-stretch place-items-center rounded-l-[5px] rounded-r-none bg-[#fff0e8] font-display text-xs font-bold text-[#c65a31]">{{ player.jerseyNumber || '—' }}</span>
    <span class="player-choice-name ml-1.5 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-[1.15] font-semibold">{{ noAssist ? t('picker.noAssist') : displayPlayerName(player.name) }}</span>
    <FoulMarker v-if="!noAssist" :count="foulCount" />
    <slot />
  </button>
</template>
