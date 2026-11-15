import type { FoulType, GameAction, StatType, TurnoverType } from '../domain/game'
import type { AppLocale } from './types'

type TranslationKey =
  | 'actions.scoreOne'
  | 'actions.scoreFew'
  | 'actions.scoreOther'
  | 'actions.missedOne'
  | 'actions.missedFew'
  | 'actions.missedOther'
  | 'actions.offensiveRebound'
  | 'actions.defensiveRebound'
  | 'actions.rebound'
  | 'actions.assist'
  | 'actions.turnover'
  | 'actions.secondDribble'
  | 'actions.travel'
  | 'actions.threeSeconds'
  | 'actions.eightSeconds'
  | 'actions.fiveSeconds'
  | 'actions.backcourtViolation'
  | 'actions.carry'
  | 'actions.outOfBounds'
  | 'actions.kickedBall'
  | 'actions.foul'
  | 'actions.personalFoul'
  | 'actions.technicalFoul'
  | 'actions.unsportsmanlikeFoul'
  | 'actions.disqualifyingFoul'
  | 'actions.block'
  | 'actions.steal'

const pluralRules: Record<AppLocale, Intl.PluralRules> = {
  nl: new Intl.PluralRules('nl'),
  en: new Intl.PluralRules('en'),
  cs: new Intl.PluralRules('cs'),
}

function pointsKey(prefix: 'score' | 'missed', value: number, locale: AppLocale): TranslationKey {
  const category = pluralRules[locale].select(value)
  const suffix = category === 'one' ? 'One' : category === 'few' ? 'Few' : 'Other'
  return `actions.${prefix}${suffix}` as TranslationKey
}

const actionKeys: Partial<Record<StatType, TranslationKey>> = {
  offensive_rebound: 'actions.offensiveRebound',
  defensive_rebound: 'actions.defensiveRebound',
  rebound: 'actions.rebound',
  assist: 'actions.assist',
  turnover: 'actions.turnover',
  foul: 'actions.foul',
  block: 'actions.block',
  steal: 'actions.steal',
}

const foulTypeKeys: Record<FoulType, TranslationKey> = {
  P: 'actions.personalFoul',
  TF: 'actions.technicalFoul',
  U: 'actions.unsportsmanlikeFoul',
  D: 'actions.disqualifyingFoul',
}

const turnoverTypeKeys: Record<TurnoverType, TranslationKey> = {
  turnover: 'actions.turnover',
  second_dribble: 'actions.secondDribble',
  travel: 'actions.travel',
  three_seconds: 'actions.threeSeconds',
  eight_seconds: 'actions.eightSeconds',
  five_seconds: 'actions.fiveSeconds',
  backcourt_violation: 'actions.backcourtViolation',
  carry: 'actions.carry',
  out_of_bounds: 'actions.outOfBounds',
  kicked_ball: 'actions.kickedBall',
}

export function turnoverTypeLabelKey(type: TurnoverType): TranslationKey {
  return turnoverTypeKeys[type]
}

// Official abbreviations shown on the turnover buttons; a plain turnover has none.
const turnoverTypeAbbreviations: Record<TurnoverType, string | null> = {
  turnover: null,
  second_dribble: 'DD',
  travel: 'TRAV',
  carry: 'CA',
  out_of_bounds: 'OOB',
  backcourt_violation: 'BC',
  kicked_ball: 'KB',
  three_seconds: '3S',
  five_seconds: '5S',
  eight_seconds: '8S',
}

export function turnoverTypeAbbreviation(type: TurnoverType): string | null {
  return turnoverTypeAbbreviations[type]
}

export function getActionTranslation(action: Pick<GameAction, 'type' | 'value' | 'foulType' | 'turnoverType'>, locale: AppLocale) {
  if (action.type === 'score') {
    return { key: pointsKey('score', action.value, locale), params: { value: action.value } }
  }
  if (action.type === 'missed_shot') {
    return { key: pointsKey('missed', action.value, locale), params: { value: action.value } }
  }
  if (action.type === 'foul' && action.foulType) {
    return { key: foulTypeKeys[action.foulType], params: undefined }
  }
  if (action.type === 'turnover' && action.turnoverType) {
    return { key: turnoverTypeKeys[action.turnoverType], params: undefined }
  }

  return { key: actionKeys[action.type] ?? 'actions.rebound', params: undefined }
}
