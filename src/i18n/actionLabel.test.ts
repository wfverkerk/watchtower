import { describe, expect, it } from 'vitest'
import { getActionTranslation } from './actionLabel'
import { messages } from './messages'
import { appLocales } from './types'
import { useLocale } from './useLocale'
import { createInitialGameState } from '../domain/game'

function translationKeys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'string'
      ? [path]
      : translationKeys(child as Record<string, unknown>, path)
  })
}

describe('localization', () => {
  it('keeps every translation key available in all supported locales', () => {
    const expectedKeys = translationKeys(messages.nl).sort()
    for (const locale of appLocales) {
      expect(translationKeys(messages[locale]).sort()).toEqual(expectedKeys)
    }
  })

  it('uses the correct localized plural category for each supported language', () => {
    const twoPointScore = { type: 'score' as const, value: 2 }
    const fourPointScore = { type: 'score' as const, value: 4 }

    expect(getActionTranslation(twoPointScore, 'nl').key).toBe('actions.scoreOther')
    expect(getActionTranslation(twoPointScore, 'en').key).toBe('actions.scoreOther')
    expect(getActionTranslation(twoPointScore, 'cs').key).toBe('actions.scoreFew')
    expect(getActionTranslation(fourPointScore, 'cs').key).toBe('actions.scoreFew')
    expect(getActionTranslation({ type: 'score', value: 5 }, 'cs').key).toBe('actions.scoreOther')
  })

  it('labels each foul type in the activity feed', () => {
    const expected = {
      P: 'actions.personalFoul',
      TF: 'actions.technicalFoul',
      U: 'actions.unsportsmanlikeFoul',
      D: 'actions.disqualifyingFoul',
    } as const

    for (const [foulType, key] of Object.entries(expected)) {
      expect(getActionTranslation({ type: 'foul', value: 1, foulType: foulType as keyof typeof expected }, 'nl').key).toBe(key)
    }
    expect(getActionTranslation({ type: 'foul', value: 1 }, 'nl').key).toBe('actions.foul')
  })

  it('labels each turnover type and legacy turnovers', () => {
    expect(getActionTranslation({ type: 'turnover', value: 1 }, 'nl').key).toBe('actions.turnover')
    expect(getActionTranslation({ type: 'turnover', value: 1, turnoverType: 'turnover' }, 'nl').key).toBe('actions.turnover')
    expect(getActionTranslation({ type: 'turnover', value: 1, turnoverType: 'second_dribble' }, 'nl').key).toBe('actions.secondDribble')
    expect(getActionTranslation({ type: 'turnover', value: 1, turnoverType: 'travel' }, 'nl').key).toBe('actions.travel')
  })

  it('creates default team and player names in the selected language', () => {
    expect(createInitialGameState('en').teams.map((team) => team.name)).toEqual(['Home', 'Away'])
    expect(createInitialGameState('cs').players[0].name).toBe('Hráč 1')
    expect(createInitialGameState('nl').players[0].name).toBe('Speler 1')
  })

  it('renders translated labels and interpolation in all supported languages', () => {
    const { locale, t } = useLocale()
    const originalLocale = locale.value
    try {
      locale.value = 'nl'
      expect(t('actions.scoreOne', { value: 1 })).toBe('+1 punt')
      locale.value = 'en'
      expect(t('actions.scoreOther', { value: 3 })).toBe('+3 points')
      locale.value = 'cs'
      expect(t('actions.scoreFew', { value: 2 })).toBe('+2 body')
      expect(t('activity.editAction', { player: 'Jan', action: '+2 body' })).toBe('Upravit akci: Jan – +2 body')
    } finally {
      locale.value = originalLocale
    }
  })
})
