import { describe, expect, it } from 'vitest'
import { messages } from './messages'
import { appLocales } from './types'

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('messages', () => {
  it('has the same keys in every locale', () => {
    const reference = flattenKeys(messages.nl).sort()
    for (const locale of appLocales) {
      expect(flattenKeys(messages[locale]).sort(), locale).toEqual(reference)
    }
  })

  it('uses single-word foul labels in the picker', () => {
    for (const locale of appLocales) {
      for (const label of Object.values(messages[locale].picker.foulTypes)) {
        expect(label).toMatch(/^\S+$/u)
      }
    }
  })
})
