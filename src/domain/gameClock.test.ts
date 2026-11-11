import { describe, expect, it } from 'vitest'
import { clockRemaining, formatClock, isYouthTeam, newPeriodClock, pauseClock, periodDuration, reconcileClock, startClock } from './gameClock'

describe('game clock', () => {
  it('classifies teams and selects period and overtime durations', () => {
    for (const team of ['X10-1', 'x12-2', 'V12-1', 'Zoebas X12-1']) expect(isYouthTeam(team)).toBe(true)
    for (const team of ['X14-1', 'V14-1', 'M12-1', 'X120-1']) expect(isYouthTeam(team)).toBe(false)
    expect(periodDuration(8, true)).toBe(240_000)
    expect(periodDuration(9, true)).toBe(300_000)
    expect(periodDuration(4, false)).toBe(600_000)
    expect(periodDuration(5, false)).toBe(300_000)
  })

  it('uses elapsed real time, pauses precisely, and does not run past zero', () => {
    let clock = startClock(newPeriodClock(1, true), 1_000)
    expect(formatClock(clockRemaining(clock, 2_500))).toBe('03:59')
    clock = pauseClock(clock, 2_500)
    expect(clockRemaining(clock, 100_000)).toBe(238_500)
    clock = startClock(clock, 100_000)
    expect(clockRemaining(clock, 400_000)).toBe(0)
    expect(reconcileClock(clock, 1, true, 400_000)).toMatchObject({ remainingMs: 0, deadline: null })
  })

  it('starts halftime automatically at the deadline, even after reopening late', () => {
    const clock = startClock(newPeriodClock(4, true), 1_000)
    const halftime = reconcileClock(clock, 4, true, 271_000)
    expect(halftime.phase).toBe('halftime')
    expect(formatClock(clockRemaining(halftime, 271_000))).toBe('09:30')
    expect(reconcileClock(clock, 4, true, 900_000)).toEqual({ phase: 'halftime', remainingMs: 0, deadline: null })
    const standard = startClock(newPeriodClock(2, false), 0)
    expect(reconcileClock(standard, 2, false, 600_000).phase).toBe('halftime')
  })
})
