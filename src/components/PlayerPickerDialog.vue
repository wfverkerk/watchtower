<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getActionTranslation } from '../i18n/actionLabel'
import { isAppLocale, useLocale } from '../i18n/useLocale'
import { turnoverTypes, type FoulType, type Player, type ShotLocation, type StatType, type TurnoverType } from '../domain/game'
import ShotLocationPicker from './ShotLocationPicker.vue'
import FoulMarker from './FoulMarker.vue'

type PendingAction = { type: StatType; value: number }
type AssistConnector = { width: number; height: number; path: string }

const { t, locale, displayPlayerName } = useLocale()

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
  <div
    class="player-picker-backdrop"
    @click.self="emit('cancel')"
    @keydown.esc.window="emit('cancel')"
  >
    <section
      class="player-picker panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-picker-title"
      :aria-label="t(action.type === 'score' ? 'picker.scoringDialog' : 'picker.playerDialog', { team: teamName, action: actionLabel(action) })"
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
          <div class="player-picker-grid">
            <button
              v-for="player in players"
              :key="player.id"
              class="player-choice picker-player"
              :class="{ selected: scorerId === player.id }"
              :aria-pressed="scorerId === player.id"
              @click="emit('select-scorer', player.id)"
            >
              <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
              <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
              <FoulMarker :count="playerFouls[player.id] ?? 0" />
            </button>
          </div>
        </section>
        <section
          v-if="action.value === 2 || action.value === 3"
          class="scoring-player-list assist-player-list"
          :aria-label="t('picker.chooseAssister')"
        >
          <h3>{{ t('picker.assister') }}</h3>
          <div class="player-picker-grid">
            <button
              v-for="player in players"
              :key="player.id"
              class="player-choice picker-player"
              :class="{
                selected: player.id === scorerId ? assistPlayerId === 'none' : assistPlayerId === player.id,
                'no-assist-button': player.id === scorerId,
              }"
              :aria-pressed="player.id === scorerId ? assistPlayerId === 'none' : assistPlayerId === player.id"
              :disabled="!scorerId"
              @click="emit('update:assistPlayerId', player.id === scorerId ? 'none' : player.id)"
            >
              <span v-if="player.id !== scorerId" class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
              <span class="player-choice-name">{{ player.id === scorerId ? t('picker.noAssist') : displayPlayerName(player.name) }}</span>
              <FoulMarker v-if="player.id !== scorerId" :count="playerFouls[player.id] ?? 0" />
            </button>
          </div>
        </section>
      </div>
      <section v-if="action.type === 'missed_shot'" class="scoring-player-list missed-shot-player-list">
        <h3>{{ t('picker.missedBy') }}</h3>
        <div class="player-picker-grid">
          <button
            v-for="player in players"
            :key="player.id"
            class="player-choice picker-player"
            :class="{ selected: action.value > 1 ? scorerId === player.id : editing && scorerId === player.id }"
            :aria-pressed="action.value > 1 ? scorerId === player.id : editing ? scorerId === player.id : undefined"
            @click="emit('select-player', player.id)"
          >
            <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
            <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
            <FoulMarker :count="playerFouls[player.id] ?? 0" />
          </button>
        </div>
      </section>
      <template v-if="action.type === 'foul'">
        <section class="scoring-player-list standard-player-list" :aria-label="t('picker.fieldPlayers')">
          <h3>{{ t('picker.fieldPlayers') }}</h3>
          <div class="player-picker-grid">
            <button
              v-for="player in players.filter((item) => item.isOnCourt && !item.isCoach)"
              :key="player.id"
              class="player-choice picker-player"
              :class="{ selected: scorerId === player.id }"
              :aria-pressed="scorerId === player.id"
              @click="emit('select-player', player.id)"
            >
              <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
              <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
              <FoulMarker :count="playerFouls[player.id] ?? 0" />
            </button>
          </div>
        </section>
        <section class="scoring-player-list standard-player-list" :aria-label="t('picker.benchAndCoaches')">
          <h3>{{ t('picker.benchAndCoaches') }}</h3>
          <div class="player-picker-grid">
            <button
              v-for="player in players.filter((item) => !item.isOnCourt)"
              :key="player.id"
              class="player-choice picker-player"
              :class="{ selected: scorerId === player.id, 'coach-choice': player.isCoach }"
              :aria-pressed="scorerId === player.id"
              @click="emit('select-player', player.id)"
            >
              <span class="jersey-number">{{ player.isCoach ? t(player.coachRole === 'assistant' ? 'picker.assistantCoach' : 'picker.coach') : player.jerseyNumber || '—' }}</span>
              <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
              <FoulMarker v-if="!player.isCoach" :count="playerFouls[player.id] ?? 0" />
            </button>
          </div>
        </section>
      </template>
      <section v-else-if="action.type !== 'score' && action.type !== 'missed_shot'" class="scoring-player-list standard-player-list" :aria-label="t('picker.choosePlayerLabel')">
        <h3>{{ editing ? t('picker.changePlayer') : t('picker.choosePlayerLabel') }}</h3>
        <div class="player-picker-grid">
          <button
            v-for="player in players"
            :key="player.id"
            class="player-choice picker-player"
            :class="{ selected: (editing || action.type === 'turnover') && scorerId === player.id }"
            :aria-pressed="editing || action.type === 'turnover' ? scorerId === player.id : undefined"
            @click="emit('select-player', player.id)"
          >
            <span class="jersey-number">{{ player.jerseyNumber || '—' }}</span>
            <span class="player-choice-name">{{ displayPlayerName(player.name) }}</span>
            <FoulMarker :count="playerFouls[player.id] ?? 0" />
          </button>
        </div>
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
    </section>
  </div>
</template>
