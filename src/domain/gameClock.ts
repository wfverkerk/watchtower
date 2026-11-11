export type GameClock = {
  phase: 'period' | 'halftime'
  remainingMs: number
  deadline: number | null
}

export function isYouthTeam(name: string) {
  return /^(?:zoebas[\s-]*)?(?:x10|x12|v12)(?:\b|[-_])/i.test(name.trim())
}

export function regulationPeriods(youth: boolean) {
  return youth ? 8 : 4
}

export function periodDuration(period: number, youth: boolean) {
  return (period > regulationPeriods(youth) ? 5 : youth ? 4 : 10) * 60_000
}

export function newPeriodClock(period: number, youth: boolean): GameClock {
  return { phase: 'period', remainingMs: periodDuration(period, youth), deadline: null }
}

export function clockRemaining(clock: GameClock, now: number) {
  return Math.max(0, clock.deadline === null ? clock.remainingMs : clock.deadline - now)
}

export function reconcileClock(clock: GameClock, period: number, youth: boolean, now: number): GameClock {
  if (clock.deadline === null || clock.deadline > now) return clock
  if (clock.phase === 'period' && period === regulationPeriods(youth) / 2) {
    const deadline = clock.deadline + 10 * 60_000
    return deadline > now
      ? { phase: 'halftime', remainingMs: 10 * 60_000, deadline }
      : { phase: 'halftime', remainingMs: 0, deadline: null }
  }
  return { ...clock, remainingMs: 0, deadline: null }
}

export function pauseClock(clock: GameClock, now: number): GameClock {
  return { ...clock, remainingMs: clockRemaining(clock, now), deadline: null }
}

export function startClock(clock: GameClock, now: number): GameClock {
  if (clock.deadline !== null || clock.remainingMs <= 0) return clock
  return { ...clock, deadline: now + clock.remainingMs }
}

export function formatClock(remainingMs: number) {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function foulPeriodGroup(period: number, youth: boolean) {
  const regular = regulationPeriods(youth)
  const bounded = Math.min(Math.max(1, period), regular)
  return youth ? Math.ceil(bounded / 2) : bounded
}
