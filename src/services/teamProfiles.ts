export const teamProfilesStorageKey = 'watchtower-team-profiles-v1'
export const teamProfileSelectionStorageKey = 'watchtower-team-profile-selection-v1'
export const teamSetupDraftStorageKey = 'watchtower-team-setup-draft-v1'

export type TeamProfilePlayer = {
  id: string
  name: string
  jerseyNumber: string
  isParticipating: boolean
  isOnCourt: boolean
}

export type TeamProfileCoach = {
  id: string
  name: string
  role: 'coach' | 'assistant'
  isParticipating: boolean
}

export type TeamProfile = {
  id: string
  name: string
  catalogTeamId?: string
  players: TeamProfilePlayer[]
  coaches: TeamProfileCoach[]
}

type StringStorage = Pick<Storage, 'getItem' | 'setItem'>

const zoebasPlayers = [
  'Marley',
  'Stef',
  'Mees',
  'Maciej',
  'Tim',
  'Morris',
  'Noud',
  'Milan',
  'Viggo',
  '',
]

const legacyZoebasNames = [
  'Marley van Beek',
  'Stef Brouwer',
  'Mees van Harmelen',
  'Maciej Kaliczak',
  'Tim Leite',
  'Morris Lookman',
  'Noud Quax',
  'Milan De Roode',
  'Viggo Verkerk',
]

export function createDefaultTeamProfiles(): TeamProfile[] {
  return [
    {
      id: 'zoebas-x12-1',
      name: 'Zoebas X12-1',
      players: zoebasPlayers.map((name, index) => ({
        id: `zoebas-player-${index + 1}`,
        name,
        jerseyNumber: '',
        isParticipating: false,
        isOnCourt: false,
      })),
      coaches: [],
    },
    {
      id: 'opponent-default',
      name: 'Tegenstander',
      players: Array.from({ length: 5 }, (_, index) => ({
        id: `opponent-player-${index + 1}`,
        name: '',
        jerseyNumber: '',
        isParticipating: false,
        isOnCourt: false,
      })),
      coaches: [],
    },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseTeamProfiles(value: unknown): TeamProfile[] {
  if (!Array.isArray(value) || !value.every((profile) =>
    isRecord(profile)
      && typeof profile.id === 'string'
      && typeof profile.name === 'string'
      && (profile.catalogTeamId === undefined || typeof profile.catalogTeamId === 'string')
      && Array.isArray(profile.players)
      && (profile.coaches === undefined || (Array.isArray(profile.coaches) && profile.coaches.every((coach) =>
        isRecord(coach)
          && typeof coach.id === 'string'
          && typeof coach.name === 'string'
          && (coach.role === undefined || coach.role === 'coach' || coach.role === 'assistant')
          && (coach.isParticipating === undefined || typeof coach.isParticipating === 'boolean'))))
      && profile.players.every((player) =>
        isRecord(player)
          && typeof player.id === 'string'
          && typeof player.name === 'string'
          && typeof player.jerseyNumber === 'string'
          && (player.isParticipating === undefined || typeof player.isParticipating === 'boolean')
          && typeof player.isOnCourt === 'boolean'))) {
    throw new Error('Saved team profiles have an invalid format.')
  }

  const profiles = value as TeamProfile[]
  if (profiles.length === 0 || new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new Error('Saved team profiles are empty or contain duplicate IDs.')
  }
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    ...(profile.catalogTeamId ? { catalogTeamId: profile.catalogTeamId } : {}),
    coaches: (profile.coaches ?? []).map((coach) => ({
      ...coach,
      role: coach.role ?? 'coach',
      isParticipating: coach.isParticipating ?? true,
    })),
    players: profile.players.map((player) => {
      const zoebasIndex = Number(player.id.replace('zoebas-player-', '')) - 1
      const isLegacyZoebasName = profile.id === 'zoebas-x12-1'
        && Number.isInteger(zoebasIndex)
        && zoebasIndex >= 0
        && player.name === legacyZoebasNames[zoebasIndex]
      return {
        ...player,
        name: isLegacyZoebasName ? zoebasPlayers[zoebasIndex] ?? player.name : player.name,
        isParticipating: player.isParticipating ?? true,
      }
    }),
  }))
}

export function loadTeamProfiles(storage: StringStorage = window.localStorage): TeamProfile[] {
  const saved = storage.getItem(teamProfilesStorageKey)
  return saved === null ? createDefaultTeamProfiles() : parseTeamProfiles(JSON.parse(saved) as unknown)
}

export function hasSavedTeamProfiles(storage: StringStorage = window.localStorage) {
  return storage.getItem(teamProfilesStorageKey) !== null
}

export function saveTeamProfiles(profiles: TeamProfile[], storage: StringStorage = window.localStorage) {
  storage.setItem(teamProfilesStorageKey, JSON.stringify(parseTeamProfiles(profiles)))
}

export type TeamSetupDraft = {
  profiles: TeamProfile[]
  selectedProfileIds: [string, string]
  catalogTeamId: string
}

export function loadTeamSetupDraft(storage: Pick<Storage, 'getItem'> = window.localStorage): TeamSetupDraft | null {
  const saved = storage.getItem(teamSetupDraftStorageKey)
  if (saved === null) return null
  const value: unknown = JSON.parse(saved)
  if (!isRecord(value) || typeof value.catalogTeamId !== 'string'
    || !Array.isArray(value.selectedProfileIds) || value.selectedProfileIds.length !== 2
    || !value.selectedProfileIds.every((id) => typeof id === 'string')
    || value.selectedProfileIds[0] === value.selectedProfileIds[1]) {
    throw new Error('Saved team setup draft has an invalid format.')
  }
  const profiles = parseTeamProfiles(value.profiles)
  if (!value.selectedProfileIds.every((id) => profiles.some((profile) => profile.id === id))) {
    throw new Error('Saved team setup draft references an unknown profile.')
  }
  return {
    profiles,
    selectedProfileIds: [value.selectedProfileIds[0], value.selectedProfileIds[1]],
    catalogTeamId: value.catalogTeamId,
  }
}

export function saveTeamSetupDraft(draft: TeamSetupDraft, storage: Pick<Storage, 'setItem'> = window.localStorage) {
  storage.setItem(teamSetupDraftStorageKey, JSON.stringify(draft))
}

export function clearTeamSetupDraft(storage: Pick<Storage, 'removeItem'> = window.localStorage) {
  storage.removeItem(teamSetupDraftStorageKey)
}

export function loadTeamProfileSelection(storage: StringStorage = window.localStorage): [string, string] | null {
  const saved = storage.getItem(teamProfileSelectionStorageKey)
  if (saved === null) return null
  const value: unknown = JSON.parse(saved)
  if (!Array.isArray(value)
    || value.length !== 2
    || !value.every((id) => typeof id === 'string')
    || value[0] === value[1]) {
    throw new Error('Saved team profile selection has an invalid format.')
  }
  return [value[0], value[1]]
}

export function saveTeamProfileSelection(selection: [string, string], storage: StringStorage = window.localStorage) {
  storage.setItem(teamProfileSelectionStorageKey, JSON.stringify(selection))
}
