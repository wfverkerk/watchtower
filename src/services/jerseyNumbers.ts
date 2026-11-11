import { getSupabaseClient } from './supabaseClient'

export type JerseyChange = {
  position: number
  name: string
  expected: string | null
  number: string | null
}

export type JerseyNumber = {
  position: number
  name: string
  number: string
}

export function reconcileJerseyNumbers(
  names: string[],
  local: string[],
  shared: JerseyNumber[],
  baseline: JerseyNumber[] | undefined,
  preserveDraft: boolean,
) {
  let conflict = false
  const numbers = names.map((name, index) => {
    const position = index + 1
    const current = shared.find((item) => item.position === position && item.name === name)?.number ?? ''
    const previous = baseline?.find((item) => item.position === position && item.name === name)?.number ?? ''
    const edited = local[index] ?? ''
    if (!preserveDraft) return current || edited
    if (!baseline) {
      if (current && edited && current !== edited) conflict = true
      return edited || current
    }
    if (edited === previous) return current
    if (current !== previous && edited !== current) conflict = true
    return edited
  })
  return { numbers, conflict }
}

export function parseJerseyNumbers(value: unknown): JerseyNumber[] {
  if (!Array.isArray(value)) throw new Error('Invalid jersey numbers.')
  const positions = new Set<number>()
  return value.map((row: unknown) => {
    if (typeof row !== 'object' || row === null
      || !('player_position' in row) || !Number.isSafeInteger(row.player_position)
      || typeof row.player_position !== 'number' || row.player_position < 1
      || !('player_name' in row) || typeof row.player_name !== 'string') {
      throw new Error('Invalid jersey numbers.')
    }
    if (!('jersey_number' in row) || typeof row.jersey_number !== 'string'
      || !/^\d{1,2}$/.test(row.jersey_number) || positions.has(row.player_position)) {
      throw new Error('Invalid jersey numbers.')
    }
    positions.add(row.player_position)
    return { position: row.player_position, name: row.player_name, number: row.jersey_number }
  })
}

export async function loadJerseyNumbers(teamId: string): Promise<JerseyNumber[]> {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('zoebas_jersey_numbers')
    .select('player_position,player_name,jersey_number').eq('team_id', teamId)
  if (error) throw error
  return parseJerseyNumbers(data)
}

export async function saveJerseyNumbers(teamId: string, changes: JerseyChange[]) {
  if (!changes.length) return
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.rpc('save_zoebas_jersey_numbers', { p_team_id: teamId, p_changes: changes })
  if (error) throw error
}
