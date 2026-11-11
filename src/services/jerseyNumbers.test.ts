import { describe, expect, it } from 'vitest'
import { parseJerseyNumbers, reconcileJerseyNumbers } from './jerseyNumbers'

describe('shared jersey numbers', () => {
  it('parses catalog positions and preserves leading zeroes', () => {
    expect(parseJerseyNumbers([
      { player_position: 1, player_name: 'Sam', jersey_number: '06' },
      { player_position: 2, player_name: 'Sam', jersey_number: '7' },
    ])).toEqual([
      { position: 1, name: 'Sam', number: '06' },
      { position: 2, name: 'Sam', number: '7' },
    ])
  })

  it('rejects invalid numbers and duplicate positions', () => {
    expect(() => parseJerseyNumbers([{ player_position: 0, player_name: 'Sam', jersey_number: '1' }])).toThrow()
    expect(() => parseJerseyNumbers([{ player_position: 1, player_name: 'Sam', jersey_number: '100' }])).toThrow()
    expect(() => parseJerseyNumbers([
      { player_position: 1, player_name: 'Sam', jersey_number: '1' },
      { player_position: 1, player_name: 'Sam', jersey_number: '2' },
    ])).toThrow()
  })

  it('uses shared numbers for a new setup and retains local numbers missing from the server', () => {
    const shared = [{ position: 1, name: 'Sam', number: '06' }]
    expect(reconcileJerseyNumbers(['Sam', 'Sam'], ['9', '8'], shared, undefined, false))
      .toEqual({ numbers: ['06', '8'], conflict: false })
  })

  it('preserves draft edits and detects changes made elsewhere', () => {
    const old = [{ position: 1, name: 'Sam', number: '2' }]
    const shared = [{ position: 1, name: 'Sam', number: '3' }]
    expect(reconcileJerseyNumbers(['Sam'], ['4'], shared, old, true))
      .toEqual({ numbers: ['4'], conflict: true })
    expect(reconcileJerseyNumbers(['Sam'], ['2'], shared, old, true))
      .toEqual({ numbers: ['3'], conflict: false })
    expect(reconcileJerseyNumbers(['Sam'], ['4'], old, old, true))
      .toEqual({ numbers: ['4'], conflict: false })
    expect(reconcileJerseyNumbers(['Sam'], ['4'], shared, undefined, true).conflict).toBe(true)
    expect(reconcileJerseyNumbers(['Sam'], [''], shared, undefined, true).numbers).toEqual(['3'])
  })

  it('does not assign numbers from an outdated catalog position', () => {
    expect(reconcileJerseyNumbers(['Alex'], [''], [{ position: 1, name: 'Sam', number: '6' }], [], true))
      .toEqual({ numbers: [''], conflict: false })
  })
})
