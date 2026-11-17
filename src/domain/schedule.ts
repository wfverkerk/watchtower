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
  // Position on the ranking just before the start of the game.
  homePosition?: number | null
  awayPosition?: number | null
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

export type TeamGroup = 'young' | 'middle' | 'other' | 'test'

// Team codes look like "V22-1" or "M16-2": the number after the letters is the age group.
export function teamAgeGroup(name: string): number | null {
  const match = /^[A-Za-z]{1,2}(\d{1,2})-/.exec(name.trim())
  return match ? Number(match[1]) : null
}

export function teamGroup(name: string, isTestTeam: boolean): TeamGroup {
  if (isTestTeam) return 'test'
  const age = teamAgeGroup(name)
  if (age !== null && age <= 12) return 'young'
  if (age !== null && age >= 14 && age <= 18) return 'middle'
  return 'other'
}

export const teamGroupLabelKeys: Record<TeamGroup, string> = {
  young: 'sessions.teamGroupYoung',
  middle: 'sessions.teamGroupMiddle',
  other: 'sessions.teamGroupOther',
  test: 'sessions.teamGroupTest',
}

export function groupTeams(names: string[], testTeams: Set<string>) {
  const order: TeamGroup[] = ['young', 'middle', 'other', 'test']
  return order
    .map((group) => ({
      group,
      teams: names.filter((name) => teamGroup(name, testTeams.has(name)) === group).sort(compareTeamNames),
    }))
    .filter((section) => section.teams.length > 0)
}

// Compares the numbers in a team name in order, so "V12-2" sorts before "V12-10" and "M14-1" before "M16-1".
export function compareTeamNames(left: string, right: string) {
  const leftNumbers = left.match(/\d+/g)?.map(Number) ?? []
  const rightNumbers = right.match(/\d+/g)?.map(Number) ?? []
  for (let index = 0; index < Math.max(leftNumbers.length, rightNumbers.length); index += 1) {
    const difference = (leftNumbers[index] ?? Infinity) - (rightNumbers[index] ?? Infinity)
    if (difference !== 0 && !Number.isNaN(difference)) return difference
  }
  return left.localeCompare(right)
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
