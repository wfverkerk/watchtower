import { getSupabaseClient } from './supabaseClient'
import { isRecord } from '../domain/guards'

export type ZoebasStaff = { name: string; role: 'coach' | 'assistant' }

export type ZoebasTeam = {
  id: string
  name: string
  sourceTeamId: string
  playerNames: string[]
  staff: ZoebasStaff[]
}

export const teamCatalogStorageKey = 'watchtower-team-catalog-v1'

export function parseZoebasTeams(value: unknown): ZoebasTeam[] {
  if (!Array.isArray(value) || !value.every((team) =>
    isRecord(team)
      && typeof team.id === 'string'
      && typeof team.name === 'string'
      && typeof team.source_team_id === 'string'
      && Array.isArray(team.player_names)
      && team.player_names.every((name) => typeof name === 'string')
      && (team.coach_names === undefined
        || (Array.isArray(team.coach_names) && team.coach_names.every((name) => typeof name === 'string')))
      && (team.coach_roles === undefined
        || (Array.isArray(team.coach_roles) && team.coach_roles.every((role) => typeof role === 'string'))))) {
    throw new Error('The Zoebas team catalog returned invalid data.')
  }
  const teams = value.map((team) => ({
    id: team.id as string,
    name: team.name as string,
    sourceTeamId: team.source_team_id as string,
    playerNames: (team.player_names as string[]).map((name) => name.trim()).filter(Boolean),
    staff: (Array.isArray(team.coach_names) ? team.coach_names as string[] : [])
      .map((name, index) => ({
        name: name.trim(),
        role: /assistant|assistent/i.test(
          Array.isArray(team.coach_roles) ? String(team.coach_roles[index] ?? '') : '',
        ) ? 'assistant' as const : 'coach' as const,
      }))
      .filter((member) => member.name),
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
    .select('id,name,source_team_id,player_names,coach_names,coach_roles')
    .order('sort_order')
  if (error) throw error
  return parseZoebasTeams(data)
}

export function saveCachedZoebasTeams(teams: ZoebasTeam[], storage: Pick<Storage, 'setItem'> = window.localStorage) {
  const rows = teams.map((team) => ({
    id: team.id, name: team.name, source_team_id: team.sourceTeamId, player_names: team.playerNames,
    coach_names: team.staff.map((member) => member.name), coach_roles: team.staff.map((member) => member.role),
  }))
  parseZoebasTeams(rows)
  storage.setItem(teamCatalogStorageKey, JSON.stringify(rows))
}

export function loadCachedZoebasTeams(storage: Pick<Storage, 'getItem'> = window.localStorage): ZoebasTeam[] | null {
  const saved = storage.getItem(teamCatalogStorageKey)
  return saved === null ? null : parseZoebasTeams(JSON.parse(saved))
}
