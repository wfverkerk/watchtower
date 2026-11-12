import { afterEach, describe, expect, it } from 'vitest'
import { useLocale } from './useLocale'

const { locale, formatPeriod } = useLocale()
afterEach(() => { locale.value = 'nl' })

describe('period labels', () => {
  it('keeps long and short quarter labels and overtime boundaries in each language', () => {
    for (const [language, quarter, period, overtime] of [
      ['nl', 'Kwart 4', 'Periode 8', 'Verlenging 1'],
      ['en', 'Quarter 4', 'Period 8', 'Overtime 1'],
      ['cs', 'Čtvrtina 4', 'Období 8', 'Prodloužení 1'],
    ] as const) {
      locale.value = language
      expect(formatPeriod(4, false)).toBe(quarter)
      expect(formatPeriod(4, false, true)).toBe('Q4')
      expect(formatPeriod(8, true, true)).toBe(period)
      expect(formatPeriod(5, false)).toBe(overtime)
      expect(formatPeriod(9, true, true)).toBe(overtime)
    }
  })
})
