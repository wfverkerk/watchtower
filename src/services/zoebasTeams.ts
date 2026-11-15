import { getSupabaseClient } from './supabaseClient'
import { isRecord } from '../domain/guards'

export type ZoebasTeam = {
  id: string
  name: string
  sourceTeamId: string
  playerNames: string[]
}

export const teamCatalogStorageKey = 'watchtower-team-catalog-v1'

export function parseZoebasTeams(value: unknown): ZoebasTeam[] {
  if (!Array.isArray(value) || !value.every((team) =>
    isRecord(team)
      && typeof team.id === 'string'
      && typeof team.name === 'string'
      && typeof team.source_team_id === 'string'
      && Array.isArray(team.player_names)
      && team.player_names.every((name) => typeof name === 'string'))) {
    throw new Error('The Zoebas team catalog returned invalid data.')
  }
  const teams = value.map((team) => ({
    id: team.id as string,
    name: team.name as string,
    sourceTeamId: team.source_team_id as string,
    playerNames: (team.player_names as string[]).map((name) => name.trim()).filter(Boolean),
  }))
  if (teams.length === 0 || new Set(teams.map((team) => team.id)).size !== teams.length) {
    throw new Error('The Zoebas team catalog is empty or contains duplicate IDs.')
  }
  return teams
}

export async function loadZoebasTeams() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase
    .from('zoebas_teams')
    .select('id,name,source_team_id,player_names')
    .order('sort_order')
  if (error) throw error
  return parseZoebasTeams(data)
}

export function saveCachedZoebasTeams(teams: ZoebasTeam[], storage: Pick<Storage, 'setItem'> = window.localStorage) {
  const rows = teams.map((team) => ({
    id: team.id, name: team.name, source_team_id: team.sourceTeamId, player_names: team.playerNames,
  }))
  parseZoebasTeams(rows)
  storage.setItem(teamCatalogStorageKey, JSON.stringify(rows))
}

export function loadCachedZoebasTeams(storage: Pick<Storage, 'getItem'> = window.localStorage): ZoebasTeam[] | null {
  const saved = storage.getItem(teamCatalogStorageKey)
  return saved === null ? null : parseZoebasTeams(JSON.parse(saved))
}
