export type ZoebasMatch = {
  id: string
  date: string
  startTime: string
  homeTeamName: string
  awayTeamName: string
  homeScore: number | null
  awayScore: number | null
  status: string
  venue: string
}

type MatchRange = 'program' | 'results'

const apiBaseUrl = 'https://api.foys.io/competition/public-api/v1'
const organisationId = 'F7729CA8-4E22-4AE3-BEDE-6E36C2F507EB'
const pageSize = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseMatch(value: unknown): ZoebasMatch {
  if (!isRecord(value)
    || typeof value.date !== 'string'
    || typeof value.startTime !== 'string'
    || typeof value.homeTeamName !== 'string'
    || typeof value.awayTeamName !== 'string') {
    throw new Error('The Zoebas match schedule returned invalid match data.')
  }
  const date = value.date.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}/.test(value.startTime)) {
    throw new Error('The Zoebas match schedule returned an invalid date or start time.')
  }
  const id = typeof value.id === 'string' || typeof value.id === 'number'
    ? String(value.id)
    : `${date}-${value.startTime}-${value.homeTeamName}-${value.awayTeamName}`
  return {
    id,
    date,
    startTime: value.startTime.slice(0, 5),
    homeTeamName: value.homeTeamName,
    awayTeamName: value.awayTeamName,
    homeScore: parseScore(value.homeScore),
    awayScore: parseScore(value.awayScore),
    status: typeof value.status === 'string' ? value.status : '',
    venue: typeof value.accommodationName === 'string' ? value.accommodationName : '',
  }
}

export function parseZoebasMatches(value: unknown): ZoebasMatch[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('The Zoebas match schedule returned invalid data.')
  }
  const matches = value.items.map(parseMatch)
  return [...new Map(matches.map((match) => [match.id, match])).values()]
}

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function loadMatches(teamId: string, range: MatchRange, now: Date): Promise<ZoebasMatch[]> {
  const matches: ZoebasMatch[] = []
  let totalCount = Number.POSITIVE_INFINITY
  for (let skipCount = 0; skipCount < totalCount; skipCount += pageSize) {
    const params = new URLSearchParams({
      organisationId,
      teamGuid: teamId,
      skipCount: String(skipCount),
      maxResultCount: String(pageSize),
      sorting: range === 'program' ? 'date asc, startTime asc' : 'date desc, startTime desc',
      [range === 'program' ? 'startDate' : 'endDate']: localDateString(now),
    })
    const response = await fetch(`${apiBaseUrl}/matches?${params}`)
    if (!response.ok) {
      throw new Error(`The Zoebas ${range} request failed (${response.status}).`)
    }
    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.items)
      || (payload.totalCount !== undefined
        && (typeof payload.totalCount !== 'number' || !Number.isInteger(payload.totalCount) || payload.totalCount < 0))) {
      throw new Error('The Zoebas match schedule returned invalid pagination data.')
    }
    const page = parseZoebasMatches(payload)
    matches.push(...page)
    totalCount = typeof payload.totalCount === 'number' ? payload.totalCount : skipCount + page.length
    if (page.length < pageSize) break
  }
  return matches
}

export async function loadZoebasMatches(teamId: string, now = new Date()) {
  if (!teamId.trim()) throw new Error('A Zoebas source team ID is required.')
  const [program, results] = await Promise.all([
    loadMatches(teamId, 'program', now),
    loadMatches(teamId, 'results', now),
  ])
  return [...new Map([...program, ...results].map((match) => [match.id, match])).values()]
    .sort((left, right) => {
      const leftTime = new Date(`${left.date}T${left.startTime}:00`).getTime()
      const rightTime = new Date(`${right.date}T${right.startTime}:00`).getTime()
      return leftTime - rightTime
    })
}

export function getRecommendedMatch(matches: ZoebasMatch[], now = new Date(), windowMinutes = 15) {
  const nowMs = now.getTime()
  const windowMs = windowMinutes * 60_000
  return matches
    .map((match) => ({
      match,
      distance: Math.abs(new Date(`${match.date}T${match.startTime}:00`).getTime() - nowMs),
    }))
    .filter(({ match, distance }) =>
      match.status !== 'Cancelled'
      && distance <= windowMs,
    )
    .sort((left, right) => left.distance - right.distance)[0]?.match ?? null
}
