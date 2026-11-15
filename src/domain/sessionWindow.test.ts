import { describe, expect, it } from 'vitest'
import { sessionPhase } from './sessionWindow'

describe('session window', () => {
  const start = '2026-11-13T12:00:00Z'
  const at = (minutes: number) => Date.parse(start) + minutes * 60_000

  it('opens 15 minutes before the start and closes 180 minutes after it', () => {
    expect(sessionPhase(start, at(-15.01))).toBe('upcoming')
    expect(sessionPhase(start, at(-15))).toBe('open')
    expect(sessionPhase(start, at(179.99))).toBe('open')
    expect(sessionPhase(start, at(180))).toBe('closed')
  })
})
