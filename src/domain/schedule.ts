export type ScheduleKind = 'program' | 'result'

export type ScheduleGame = {
  id: string
  kind: ScheduleKind
  date: string
  startTime: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string
  venue: string
  hasStats?: boolean
  homeClub?: string | null
  awayClub?: string | null
  homeLogoUrl?: string | null
  awayLogoUrl?: string | null
}

export type ScheduleBucket = 'open' | 'upcoming' | 'history'

export const gameDurationMs = 180 * 60_000

export function gameStartMs(game: Pick<ScheduleGame, 'date' | 'startTime'>) {
  return new Date(`${game.date}T${game.startTime}:00`).getTime()
}

export function localDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function scheduleBucket(game: ScheduleGame, now: number, today = localDateKey(new Date(now))): ScheduleBucket {
  if (game.kind === 'result') return 'history'
  if (game.date < today) return 'history'
  if (game.date > today) return 'upcoming'
  return now >= gameStartMs(game) + gameDurationMs ? 'history' : 'open'
}

export function groupByDay(games: ScheduleGame[]) {
  const groups = new Map<string, ScheduleGame[]>()
  for (const game of games) {
    groups.set(game.date, [...(groups.get(game.date) ?? []), game])
  }
  return [...groups.entries()].map(([date, items]) => ({ date, games: items }))
}

export function winnerSide(game: ScheduleGame): 'home' | 'away' | null {
  if (game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore) return null
  return game.homeScore > game.awayScore ? 'home' : 'away'
}
