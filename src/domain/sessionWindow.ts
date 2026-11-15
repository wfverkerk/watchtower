const opensBeforeMs = 15 * 60_000
const closesAfterMs = 180 * 60_000

export type SessionPhase = 'upcoming' | 'open' | 'closed'

export function sessionPhase(startsAt: string, now: number): SessionPhase {
  const start = Date.parse(startsAt)
  if (now < start - opensBeforeMs) return 'upcoming'
  return now >= start + closesAfterMs ? 'closed' : 'open'
}
