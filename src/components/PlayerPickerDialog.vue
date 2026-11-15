<script setup lang="ts">
import { computed } from 'vue'
import { getActionTranslation } from '../i18n/actionLabel'
import { isAppLocale, useLocale } from '../i18n/useLocale'
import { turnoverTypes, type FoulType, type Player, type ShotLocation, type StatType, type TurnoverType } from '../domain/game'
import type { EventFlowStep } from '../domain/eventFlow'
import ShotLocationPicker from './ShotLocationPicker.vue'
import EventFlowPlayerButton from './EventFlowPlayerButton.vue'
import BaseDialog from './BaseDialog.vue'

type PendingAction = { type: StatType; value: number }

const { t, locale } = useLocale()

// One question per step; the flow itself is driven by the session composable.
const props = defineProps<{
  action: PendingAction
  flow: EventFlowStep[]
  stepIndex: number
  teamName: string
  players: Player[]
  scorerId: string
  assistPlayerId: string | 'none' | null
  reboundId: string | 'opponent' | 'none' | null
  shotLocation: ShotLocation | null
  editing: boolean
  foulType: FoulType | null
  turnoverType: TurnoverType
  playerFouls: Record<string, number>
}>()

const emit = defineEmits<{
  cancel: []
  'go-to-step': [index: number]
  'select-player': [playerId: string]
  'select-assist': [playerId: string | 'none']
  'select-rebound': [playerId: string | 'opponent' | 'none']
  'update:shotLocation': [location: ShotLocation]
  'select-foul-type': [foulType: FoulType]
  'select-turnover-type': [turnoverType: TurnoverType]
  finish: []
}>()

const currentStep = computed(() => props.flow[props.stepIndex])
const progressPercent = computed(() => ((props.stepIndex + 1) / props.flow.length) * 100)
const assistCandidates = computed(() => props.players.filter((player) => player.id !== props.scorerId))
const questionLabel = computed(() => {
  switch (currentStep.value) {
    case 'player':
      if (props.editing) return t('picker.changePlayer')
      if (props.action.type === 'score') return t('picker.chooseScorer')
      return props.action.type === 'missed_shot' ? t('picker.missedBy') : t('picker.choosePlayerLabel')
    case 'assist': return t('picker.chooseAssister')
    case 'rebound': return t('picker.reboundQuestion')
    case 'location': return t('picker.flowLocation')
    case 'foulType': return t('picker.foulType')
    case 'turnoverType': return t('picker.turnoverType')
    default: return ''
  }
})

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
      <div class="event-flow-progress">
        <div class="event-flow-meta">
          <button v-if="stepIndex > 0" type="button" class="event-flow-back" @click="emit('go-to-step', stepIndex - 1)">{{ t('picker.back') }}</button>
          <span>{{ t('picker.flowStep', { step: stepIndex + 1, total: flow.length }) }}</span>
        </div>
        <div
          class="event-flow-bar"
          role="progressbar"
          :aria-label="t('picker.flowProgress')"
          :aria-valuemin="1"
          :aria-valuemax="flow.length"
          :aria-valuenow="stepIndex + 1"
        >
          <span class="event-flow-fill" :style="{ width: `${progressPercent}%` }" />
        </div>
      </div>

      <div class="player-picker-heading">
        <div>
          <p class="eyebrow">{{ teamName }} · {{ actionLabel(action) }}</p>
          <h2 id="player-picker-title">{{ questionLabel }}</h2>
        </div>
      </div>

      <template v-if="currentStep === 'player'">
        <template v-if="action.type === 'foul'">
          <section class="scoring-player-list" :aria-label="t('picker.fieldPlayers')">
            <h3>{{ t('picker.fieldPlayers') }}</h3>
            <div class="event-flow-grid">
              <EventFlowPlayerButton
                v-for="player in players.filter((item) => item.isOnCourt && !item.isCoach)"
                :key="player.id"
                :player="player"
                :foul-count="playerFouls[player.id] ?? 0"
                :selected="scorerId === player.id"
                @click="emit('select-player', player.id)"
              />
            </div>
          </section>
          <section class="scoring-player-list" :aria-label="t('picker.benchAndCoaches')">
            <h3>{{ t('picker.benchAndCoaches') }}</h3>
            <div class="event-flow-grid">
              <EventFlowPlayerButton
                v-for="player in players.filter((item) => !item.isOnCourt)"
                :key="player.id"
                :player="player"
                :foul-count="playerFouls[player.id] ?? 0"
                :selected="scorerId === player.id"
                @click="emit('select-player', player.id)"
              />
            </div>
          </section>
        </template>
        <section v-else class="scoring-player-list" :aria-label="questionLabel">
          <div class="event-flow-grid">
            <EventFlowPlayerButton
              v-for="player in players"
              :key="player.id"
              :player="player"
              :foul-count="playerFouls[player.id] ?? 0"
              :selected="scorerId === player.id"
              @click="emit('select-player', player.id)"
            />
          </div>
        </section>
      </template>

      <section v-else-if="currentStep === 'assist'" class="scoring-player-list" :aria-label="t('picker.chooseAssister')">
        <div class="event-flow-grid">
          <button
            type="button"
            class="event-flow-player event-flow-special"
            :class="{ selected: assistPlayerId === 'none' }"
            :aria-pressed="assistPlayerId === 'none'"
            @click="emit('select-assist', 'none')"
          >
            <span class="event-flow-name">{{ t('picker.noAssist') }}</span>
          </button>
          <EventFlowPlayerButton
            v-for="player in assistCandidates"
            :key="player.id"
            :player="player"
            :foul-count="playerFouls[player.id] ?? 0"
            :selected="assistPlayerId === player.id"
            @click="emit('select-assist', player.id)"
          />
        </div>
      </section>

      <section v-else-if="currentStep === 'rebound'" class="scoring-player-list" :aria-label="t('picker.reboundQuestion')">
        <div class="event-flow-grid">
          <EventFlowPlayerButton
            v-for="player in players"
            :key="player.id"
            :player="player"
            :foul-count="playerFouls[player.id] ?? 0"
            :selected="reboundId === player.id"
            @click="emit('select-rebound', player.id)"
          />
          <button
            type="button"
            class="event-flow-player event-flow-special"
            :class="{ selected: reboundId === 'opponent' }"
            :aria-pressed="reboundId === 'opponent'"
            @click="emit('select-rebound', 'opponent')"
          >
            <span class="event-flow-name">{{ t('picker.reboundOpponent') }}</span>
          </button>
        </div>
        <button
          type="button"
          class="event-flow-extra"
          :class="{ selected: reboundId === 'none' }"
          :aria-pressed="reboundId === 'none'"
          @click="emit('select-rebound', 'none')"
        >{{ t('picker.noRebound') }}</button>
      </section>

      <ShotLocationPicker
        v-else-if="currentStep === 'location'"
        :location="shotLocation"
        @update:location="emit('update:shotLocation', $event)"
      />

      <section v-else-if="currentStep === 'foulType'" class="foul-type-picker" :aria-label="t('picker.foulType')">
        <div class="foul-type-options">
          <button
            v-for="type in (['P', 'TF', 'U', 'D'] as const)"
            :key="type"
            type="button"
            class="foul-type-option"
            :class="{ selected: foulType === type }"
            :aria-pressed="foulType === type"
            @click="emit('select-foul-type', type)"
          >
            <strong>{{ type }}</strong>
            <span>{{ t(`picker.foulTypes.${type}`) }}</span>
          </button>
        </div>
      </section>

      <section v-else-if="currentStep === 'turnoverType'" class="foul-type-picker" :aria-label="t('picker.turnoverType')">
        <div class="turnover-type-options">
          <button
            v-for="type in turnoverTypes"
            :key="type"
            type="button"
            class="foul-type-option"
            :class="{ selected: turnoverType === type }"
            :aria-pressed="turnoverType === type"
            @click="emit('select-turnover-type', type)"
          >{{ t(`picker.turnoverTypes.${type}`) }}</button>
        </div>
      </section>

      <div class="scoring-picker-footer">
        <button class="picker-cancel" @click="emit('cancel')">{{ t('picker.cancel') }}</button>
        <button class="picker-confirm" :disabled="!scorerId" @click="emit('finish')">{{ t('picker.submit') }}</button>
      </div>
  </BaseDialog>
</template>

