import { getSupabaseClient } from './supabaseClient'
import type { ScheduleGame, ScheduleKind } from '../domain/schedule'

type ScheduleRow = {
  id: string
  kind: ScheduleKind
  match_date: string
  start_time: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  status: string
  venue: string
}

export async function loadSchedule(): Promise<ScheduleGame[]> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  const { data, error } = await client
    .from('zoebas_schedule')
    .select('id, kind, match_date, start_time, home_team, away_team, home_score, away_score, status, venue')
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(1000)
  if (error) throw error
  const { data: statsData, error: statsError } = await client.rpc('scheduled_games_with_stats')
  if (statsError) console.error('Failed to load which games have statistics.', statsError)
  const withStats = new Set<string>(statsError ? [] : (statsData as string[] | null) ?? [])
  return (data as ScheduleRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    date: row.match_date,
    startTime: row.start_time.slice(0, 5),
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeScore: row.home_score,
    awayScore: row.away_score,
    status: row.status,
    venue: row.venue,
    hasStats: withStats.has(row.id),
  }))
}
