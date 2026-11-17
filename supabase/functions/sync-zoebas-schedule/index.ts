import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const apiBaseUrl = 'https://api.foys.io/competition/public-api/v1'
const organisationId = 'F7729CA8-4E22-4AE3-BEDE-6E36C2F507EB'
const federationId = '52CFA65E-9782-4A81-AB35-E2F981FCB7A9'
const pageSize = 100
const timeZone = 'Europe/Amsterdam'
// The FOYS API rejects requests without a browser-like user agent.
const foysHeaders = { 'X-FederationId': federationId, 'User-Agent': 'Mozilla/5.0' }

type Kind = 'program' | 'result'

type Row = {
  id: string
  kind: Kind
  match_date: string
  start_time: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  status: string
  venue: string
  home_club: string | null
  away_club: string | null
  home_logo_url: string | null
  away_logo_url: string | null
  competition_id: number
  home_team_guid: string | null
  away_team_guid: string | null
  synced_at: string
}

function optionalText(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function optionalUrl(value: unknown) {
  return typeof value === 'string' && /^https:\/\//.test(value) ? value.slice(0, 500) : null
}

function optionalGuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : null
}

function localDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function toRow(kind: Kind, competitionId: number, value: Record<string, unknown>, syncedAt: string): Row | null {
  const date = typeof value.date === 'string' ? value.date.slice(0, 10) : ''
  const time = typeof value.startTime === 'string' ? value.startTime.slice(0, 5) : ''
  const home = typeof value.homeTeamName === 'string' ? value.homeTeamName.trim() : ''
  const away = typeof value.awayTeamName === 'string' ? value.awayTeamName.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !home || !away) return null
  const id = value.id !== undefined && value.id !== null ? String(value.id) : `${kind}-${date}-${time}-${home}-${away}`
  const score = (input: unknown) => (typeof input === 'number' && Number.isInteger(input) ? input : null)
  return {
    id,
    kind,
    match_date: date,
    start_time: `${time}:00`,
    home_team: home.slice(0, 60),
    away_team: away.slice(0, 60),
    home_score: score(value.homeScore),
    away_score: score(value.awayScore),
    status: typeof value.status === 'string' ? value.status : '',
    venue: typeof value.accommodationName === 'string' ? value.accommodationName : '',
    home_club: optionalText((value.homeOrganisation as { name?: unknown } | undefined)?.name, 60),
    away_club: optionalText((value.awayOrganisation as { name?: unknown } | undefined)?.name, 60),
    home_logo_url: optionalUrl(value.homeLogoUrl),
    away_logo_url: optionalUrl(value.awayLogoUrl),
    competition_id: competitionId,
    home_team_guid: optionalGuid(value.homeTeamGuid),
    away_team_guid: optionalGuid(value.awayTeamGuid),
    synced_at: syncedAt,
  }
}

async function fetchRange(competitionId: number, kind: Kind, now: Date, syncedAt: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let skipCount = 0; ; skipCount += pageSize) {
    const params = new URLSearchParams({
      organisationId,
      competitionId: String(competitionId),
      skipCount: String(skipCount),
      maxResultCount: String(pageSize),
      sorting: kind === 'program' ? 'date asc, startTime asc' : 'date desc, startTime desc',
      [kind === 'program' ? 'startDate' : 'endDate']: localDate(now),
    })
    const response = await fetch(`${apiBaseUrl}/matches?${params}`, { headers: foysHeaders })
    if (!response.ok) throw new Error(`Foys ${kind} request failed (${response.status}).`)
    const payload = await response.json() as { items?: Record<string, unknown>[] }
    const items = Array.isArray(payload.items) ? payload.items : []
    for (const item of items) {
      const row = toRow(kind, competitionId, item, syncedAt)
      if (row) rows.push(row)
    }
    if (items.length < pageSize) break
  }
  return rows
}

type PoolTeam = { teamGuid: string; position: number }

// Converts a local Amsterdam date and time to an instant, so the start can be compared with now.
function amsterdamStart(date: string, time: string) {
  const naive = Date.parse(`${date}T${time.slice(0, 5)}:00Z`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(naive)).map((part) => [part.type, Number(part.value)]))
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - naive
  return new Date(naive - offset)
}

async function foysJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/${path}`, { headers: foysHeaders })
  if (!response.ok) throw new Error(`Foys ${path} request failed (${response.status}).`)
  return await response.json() as T
}

// Current position of every team in the competition, read from all of its pools.
async function competitionPositions(competitionId: number) {
  const competition = await foysJson<{ pools?: { id: number }[] }>(`competitions/${competitionId}`)
  const positions = new Map<string, number>()
  for (const pool of competition.pools ?? []) {
    const teams = await foysJson<PoolTeam[]>(`competitions/${competitionId}/pools/${pool.id}/teams`)
    for (const team of teams) {
      if (typeof team.teamGuid === 'string' && Number.isInteger(team.position)) {
        positions.set(team.teamGuid.toLowerCase(), team.position)
      }
    }
  }
  return positions
}

// Only games that have not started yet are refreshed, so the position is the one from just before the start.
async function refreshStandings(supabase: SupabaseClient, now: Date) {
  const { data, error } = await supabase.from('zoebas_schedule')
    .select('id, competition_id, match_date, start_time, home_team_guid, away_team_guid')
    .eq('kind', 'program')
    .not('competition_id', 'is', null)
  if (error) throw new Error(error.message)
  const upcoming = (data ?? []).filter((game) => amsterdamStart(game.match_date, game.start_time) > now)
  const byCompetition = new Map<number, typeof upcoming>()
  for (const game of upcoming) {
    byCompetition.set(game.competition_id, [...(byCompetition.get(game.competition_id) ?? []), game])
  }

  let updated = 0
  for (const [competitionId, games] of byCompetition) {
    let positions: Map<string, number>
    try {
      positions = await competitionPositions(competitionId)
    } catch (reason) {
      console.error(`Standings for competition ${competitionId} could not be read.`, reason)
      continue
    }
    for (const game of games) {
      const change: { home_position?: number; away_position?: number } = {}
      const home = game.home_team_guid ? positions.get(game.home_team_guid) : undefined
      const away = game.away_team_guid ? positions.get(game.away_team_guid) : undefined
      if (home !== undefined) change.home_position = home
      if (away !== undefined) change.away_position = away
      if (Object.keys(change).length === 0) continue
      const { error: updateError } = await supabase.from('zoebas_schedule').update(change).eq('id', game.id)
      if (updateError) throw new Error(updateError.message)
      updated += 1
    }
  }
  return updated
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('SYNC_SECRET') ?? ''
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const now = new Date()
  if (new URL(request.url).searchParams.get('mode') === 'standings') {
    try {
      return Response.json({ standings: await refreshStandings(supabase, now) })
    } catch (reason) {
      return new Response(reason instanceof Error ? reason.message : 'Standings refresh failed.', { status: 502 })
    }
  }

  const { data: competitions, error: competitionsError } = await supabase.from('zoebas_competitions').select('id')
  if (competitionsError) return new Response(competitionsError.message, { status: 500 })

  const syncedAt = now.toISOString()
  const rows = new Map<string, Row>()
  try {
    for (const competition of competitions ?? []) {
      for (const kind of ['program', 'result'] as const) {
        for (const row of await fetchRange(Number(competition.id), kind, now, syncedAt)) {
          rows.set(row.id, row)
        }
      }
    }
  } catch (reason) {
    return new Response(reason instanceof Error ? reason.message : 'Sync failed.', { status: 502 })
  }

  const { error } = await supabase.from('zoebas_schedule').upsert([...rows.values()], { onConflict: 'id' })
  if (error) return new Response(error.message, { status: 500 })
  try {
    await refreshStandings(supabase, now)
  } catch (reason) {
    console.error('Standings refresh failed after the schedule sync.', reason)
  }
  return Response.json({ synced: rows.size })
})
