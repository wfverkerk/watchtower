import { createClient } from 'npm:@supabase/supabase-js@2'

const apiBaseUrl = 'https://api.foys.io/competition/public-api/v1'
const organisationId = 'F7729CA8-4E22-4AE3-BEDE-6E36C2F507EB'
const pageSize = 100
const timeZone = 'Europe/Amsterdam'

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
  synced_at: string
}

function localDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function toRow(kind: Kind, value: Record<string, unknown>, syncedAt: string): Row | null {
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
    synced_at: syncedAt,
  }
}

async function fetchRange(teamGuid: string, kind: Kind, now: Date, syncedAt: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let skipCount = 0; ; skipCount += pageSize) {
    const params = new URLSearchParams({
      organisationId,
      teamGuid,
      skipCount: String(skipCount),
      maxResultCount: String(pageSize),
      sorting: kind === 'program' ? 'date asc, startTime asc' : 'date desc, startTime desc',
      [kind === 'program' ? 'startDate' : 'endDate']: localDate(now),
    })
    const response = await fetch(`${apiBaseUrl}/matches?${params}`)
    if (!response.ok) throw new Error(`Foys ${kind} request failed (${response.status}).`)
    const payload = await response.json() as { items?: Record<string, unknown>[] }
    const items = Array.isArray(payload.items) ? payload.items : []
    for (const item of items) {
      const row = toRow(kind, item, syncedAt)
      if (row) rows.push(row)
    }
    if (items.length < pageSize) break
  }
  return rows
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('SYNC_SECRET') ?? ''
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data: teams, error: teamsError } = await supabase.from('zoebas_teams').select('source_team_id')
  if (teamsError) return new Response(teamsError.message, { status: 500 })

  const now = new Date()
  const syncedAt = now.toISOString()
  const rows = new Map<string, Row>()
  try {
    for (const team of teams ?? []) {
      for (const kind of ['program', 'result'] as const) {
        for (const row of await fetchRange(String(team.source_team_id), kind, now, syncedAt)) {
          rows.set(row.id, row)
        }
      }
    }
  } catch (reason) {
    return new Response(reason instanceof Error ? reason.message : 'Sync failed.', { status: 502 })
  }

  const { error } = await supabase.from('zoebas_schedule').upsert([...rows.values()], { onConflict: 'id' })
  if (error) return new Response(error.message, { status: 500 })
  return Response.json({ synced: rows.size })
})
