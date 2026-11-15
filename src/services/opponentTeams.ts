import { isRecord } from '../domain/guards'
import { getSupabaseClient } from './supabaseClient'

export type OpponentTeam = { id: string; name: string; logoFile: string | null }

export const opponentTeamsStorageKey = 'watchtower-opponent-teams-v1'
const logoBucket = 'logos'

export function parseOpponentTeams(value: unknown): OpponentTeam[] {
  if (!Array.isArray(value) || !value.every((team) => isRecord(team) && typeof team.id === 'string'
    && typeof team.name === 'string' && (team.logo_file === null || team.logo_file === undefined || typeof team.logo_file === 'string'))) {
    throw new Error('The opponent team list returned invalid data.')
  }
  return value.map((team) => ({
    id: String(team.id), name: String(team.name).trim(), logoFile: typeof team.logo_file === 'string' ? team.logo_file : null,
  })).filter((team) => team.name)
}

export function loadCachedOpponentTeams(storage: Pick<Storage, 'getItem'> = window.localStorage): OpponentTeam[] {
  try {
    const saved = storage.getItem(opponentTeamsStorageKey)
    return saved === null ? [] : parseOpponentTeams(JSON.parse(saved))
  } catch (error) {
    console.error('Failed to read the cached opponent teams.', error)
    return []
  }
}

function saveCachedOpponentTeams(teams: OpponentTeam[], storage: Pick<Storage, 'setItem'> = window.localStorage) {
  try {
    storage.setItem(opponentTeamsStorageKey, JSON.stringify(teams.map((team) => ({ id: team.id, name: team.name, logo_file: team.logoFile }))))
  } catch (error) {
    console.error('Failed to cache the opponent teams.', error)
  }
}

export async function loadOpponentTeams(): Promise<OpponentTeam[]> {
  const client = getSupabaseClient()
  if (!client) return loadCachedOpponentTeams()
  const rows: unknown[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('opponent_teams').select('id,name,logo_file').order('name').range(offset, offset + 999)
    if (error) throw new Error(error.message)
    if (!Array.isArray(data)) throw new Error('The opponent team list returned invalid data.')
    rows.push(...data)
    if (data.length < 1000) break
  }
  const teams = parseOpponentTeams(rows)
  saveCachedOpponentTeams(teams)
  return teams
}

export function opponentLogoUrl(team: Pick<OpponentTeam, 'logoFile'>) {
  if (!team.logoFile) return null
  try {
    return getSupabaseClient()?.storage.from(logoBucket).getPublicUrl(team.logoFile).data.publicUrl ?? null
  } catch {
    return null
  }
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

export function findOpponentTeam(teams: OpponentTeam[], name: string) {
  const key = normalize(name)
  return key ? teams.find((team) => normalize(team.name) === key) ?? null : null
}

export function suggestOpponentTeams(teams: OpponentTeam[], query: string, limit = 8) {
  const key = normalize(query)
  if (!key) return []
  const starts: OpponentTeam[] = []
  const contains: OpponentTeam[] = []
  for (const team of teams) {
    const name = normalize(team.name)
    if (name.startsWith(key) || name.split(' ').some((word) => word.startsWith(key))) starts.push(team)
    else if (name.includes(key)) contains.push(team)
  }
  return [...starts, ...contains].slice(0, limit)
}
