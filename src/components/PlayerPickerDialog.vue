<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getActionTranslation } from '../i18n/actionLabel'
import { isAppLocale, useLocale } from '../i18n/useLocale'
import { turnoverTypes, type FoulType, type Player, type ShotLocation, type StatType, type TurnoverType } from '../domain/game'
import ShotLocationPicker from './ShotLocationPicker.vue'
import PlayerSelectionList from './PlayerSelectionList.vue'
import BaseDialog from './BaseDialog.vue'

type PendingAction = { type: StatType; value: number }
type AssistConnector = { width: number; height: number; path: string }

const { t, locale } = useLocale()

const props = defineProps<{
  action: PendingAction
  teamName: string
  players: Player[]
  scorerId: string
  assistPlayerId: string | 'none' | null
  shotLocation: ShotLocation | null
  editing: boolean
  foulType: FoulType | null
  turnoverType: TurnoverType
  playerFouls: Record<string, number>
}>()

const scoringLists = ref<HTMLElement | null>(null)
const assistConnector = ref<AssistConnector | null>(null)
let resizeObserver: ResizeObserver | null = null

const emit = defineEmits<{
  cancel: []
  'select-player': [playerId: string]
  'select-scorer': [playerId: string]
  'update:assistPlayerId': [playerId: string | 'none' | null]
  'update:shotLocation': [location: ShotLocation]
  'update:foulType': [foulType: FoulType]
  'update:turnoverType': [turnoverType: TurnoverType]
  'finish-shot': []
  'finish-foul': []
  'finish-turnover': []
}>()

function updateAssistConnector() {
  const container = scoringLists.value
  const assister = container?.querySelector<HTMLElement>('.assist-player-list .picker-player.selected:not(.no-assist-button)')
  const scorer = container?.querySelector<HTMLElement>('.scorer-player-list .picker-player.selected')
  if (!container || !assister || !scorer || props.assistPlayerId === null || props.assistPlayerId === 'none') {
    assistConnector.value = null
    return
  }

  const containerRect = container.getBoundingClientRect()
  const assisterRect = assister.getBoundingClientRect()
  const scorerRect = scorer.getBoundingClientRect()
  const startX = assisterRect.left - containerRect.left
  const startY = assisterRect.top + assisterRect.height / 2 - containerRect.top
  const endX = scorerRect.right - containerRect.left
  const endY = scorerRect.top + scorerRect.height / 2 - containerRect.top
  const controlX = (startX + endX) / 2
  assistConnector.value = {
    width: containerRect.width,
    height: containerRect.height,
    path: `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`,
  }
}

watch(
  () => [props.scorerId, props.assistPlayerId, props.players],
  () => void nextTick(updateAssistConnector),
  { flush: 'post' },
)

onMounted(() => {
  if (scoringLists.value) {
    resizeObserver = new ResizeObserver(updateAssistConnector)
    resizeObserver.observe(scoringLists.value)
  }
  updateAssistConnector()
})

onBeforeUnmount(() => resizeObserver?.disconnect())

function actionLabel(action: PendingAction) {
  const { key, params } = getActionTranslation(action, isAppLocale(locale.value) ? locale.value : 'nl')
  return t(key, params ?? {})
}
</script>

<template>
  <BaseDialog
    backdrop-class="player-picker-backdrop"
    dialog-class="player-picker panel"
    labelledby="player-picker-title"
    :label="t(action.type === 'score' ? 'picker.scoringDialog' : 'picker.playerDialog', { team: teamName, action: actionLabel(action) })"
    close-on-backdrop
    @close="emit('cancel')"
  >
      <div class="player-picker-heading">
        <div>
          <p
            v-if="action.type === 'score' || action.type === 'missed_shot'"
            id="player-picker-title"
            class="scoring-picker-title"
          >{{ teamName }} · {{ actionLabel(action) }}</p>
          <template v-else>
            <p class="eyebrow">{{ teamName }} · {{ actionLabel(action) }}</p>
            <h2 id="player-picker-title">{{ t('picker.choosePlayer') }}</h2>
          </template>
        </div>
      </div>

      <div
        v-if="action.type === 'score'"
        ref="scoringLists"
        class="scoring-player-lists"
        :class="{ 'single-scorer-list': action.value === 1 }"
      >
        <svg
          v-if="assistConnector"
          class="assist-connector"
          :viewBox="`0 0 ${assistConnector.width} ${assistConnector.height}`"
          aria-hidden="true"
        >
          <path class="assist-connector-line" :d="assistConnector.path" />
        </svg>
        <section class="scoring-player-list scorer-player-list" :aria-label="t('picker.chooseScorer')">
          <h3>{{ t('picker.scorer') }}</h3>
          <PlayerSelectionList class="player-picker-grid" :players="players" :player-fouls="playerFouls" :selected-ids="[scorerId]" @select="emit('select-scorer', $event)" />
        </section>
        <section
          v-if="action.value === 2 || action.value === 3"
          class="scoring-player-list assist-player-list"
          :aria-label="t('picker.chooseAssister')"
        >
          <h3>{{ t('picker.assister') }}</h3>
          <PlayerSelectionList class="player-picker-grid" :players="players" :player-fouls="playerFouls" :selected-ids="assistPlayerId === null ? [] : [assistPlayerId]" :no-assist-player-id="scorerId" :disabled="!scorerId" @select="emit('update:assistPlayerId', $event)" />
        </section>
      </div>
      <section v-if="action.type === 'missed_shot'" class="scoring-player-list missed-shot-player-list">
        <h3>{{ t('picker.missedBy') }}</h3>
        <PlayerSelectionList class="player-picker-grid" :players="players" :player-fouls="playerFouls" :selected-ids="action.value > 1 || editing ? [scorerId] : []" :show-pressed="action.value > 1 || editing" @select="emit('select-player', $event)" />
      </section>
      <template v-if="action.type === 'foul'">
        <section class="scoring-player-list standard-player-list" :aria-label="t('picker.fieldPlayers')">
          <h3>{{ t('picker.fieldPlayers') }}</h3>
          <PlayerSelectionList class="player-picker-grid" :players="players.filter((item) => item.isOnCourt && !item.isCoach)" :player-fouls="playerFouls" :selected-ids="[scorerId]" @select="emit('select-player', $event)" />
        </section>
        <section class="scoring-player-list standard-player-list" :aria-label="t('picker.benchAndCoaches')">
          <h3>{{ t('picker.benchAndCoaches') }}</h3>
          <PlayerSelectionList class="player-picker-grid" :players="players.filter((item) => !item.isOnCourt)" :player-fouls="playerFouls" :selected-ids="[scorerId]" @select="emit('select-player', $event)" />
        </section>
      </template>
      <section v-else-if="action.type !== 'score' && action.type !== 'missed_shot'" class="scoring-player-list standard-player-list" :aria-label="t('picker.choosePlayerLabel')">
        <h3>{{ editing ? t('picker.changePlayer') : t('picker.choosePlayerLabel') }}</h3>
        <PlayerSelectionList class="player-picker-grid" :players="players" :player-fouls="playerFouls" :selected-ids="editing || action.type === 'turnover' ? [scorerId] : []" :show-pressed="editing || action.type === 'turnover'" @select="emit('select-player', $event)" />
      </section>
      <section v-if="action.type === 'foul' && scorerId" class="foul-type-picker" :aria-label="t('picker.foulType')">
        <h3>{{ t('picker.foulType') }}</h3>
        <div class="foul-type-options">
          <button
            v-for="type in (['P', 'TF', 'U', 'D'] as const)"
            :key="type"
            type="button"
            class="foul-type-option"
            :class="{ selected: foulType === type }"
            :aria-pressed="foulType === type"
            @click="emit('update:foulType', type)"
          >
            <strong>{{ type }}</strong>
            <span>{{ t(`picker.foulTypes.${type}`) }}</span>
          </button>
        </div>
      </section>
      <section v-if="action.type === 'turnover'" class="foul-type-picker" :aria-label="t('picker.turnoverType')">
        <h3>{{ t('picker.turnoverType') }}</h3>
        <div class="turnover-type-options">
          <button
            v-for="type in turnoverTypes"
            :key="type"
            type="button"
            class="foul-type-option"
            :class="{ selected: turnoverType === type }"
            :aria-pressed="turnoverType === type"
            @click="emit('update:turnoverType', type)"
          >{{ t(`picker.turnoverTypes.${type}`) }}</button>
        </div>
      </section>
      <ShotLocationPicker
        v-if="(action.type === 'score' || action.type === 'missed_shot') && action.value > 1"
        :location="shotLocation"
        @update:location="emit('update:shotLocation', $event)"
      />

      <div v-if="(action.type === 'score' || action.type === 'missed_shot') && action.value > 1" class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">{{ t('picker.cancel') }}</button>
        <button
          class="picker-confirm"
          :disabled="!scorerId || (action.type === 'score' && assistPlayerId === null)"
          @click="emit('finish-shot')"
        >
          {{ t(action.type === 'score' ? 'picker.confirmScore' : 'picker.confirmShot') }}
        </button>
      </div>
      <div v-else-if="action.type === 'foul'" class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">{{ t('picker.cancel') }}</button>
        <button class="picker-confirm" :disabled="!scorerId || !foulType" @click="emit('finish-foul')">
          {{ t('picker.confirmFoul') }}
        </button>
      </div>
      <div v-else-if="action.type === 'turnover'" class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">{{ t('picker.cancel') }}</button>
        <button class="picker-confirm" :disabled="!scorerId" @click="emit('finish-turnover')">
          {{ t('picker.confirmTurnover') }}
        </button>
      </div>
      <button v-else class="picker-cancel" @click="emit('cancel')">{{ t('picker.cancel') }}</button>
  </BaseDialog>
</template>
