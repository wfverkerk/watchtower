import { describe, expect, it } from 'vitest'
import {
  createDefaultTeamProfiles,
  loadTeamProfileSelection,
  loadTeamProfiles,
  parseTeamProfiles,
  saveTeamProfileSelection,
  saveTeamProfiles,
  teamProfileSelectionStorageKey,
  teamProfilesStorageKey,
} from './teamProfiles'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('team profile storage', () => {
  it('starts with the visible Zoebas roster and a blank opponent roster', () => {
    const [home, away] = loadTeamProfiles(createStorage())
    expect(home.name).toBe('Zoebas X12-1')
    expect(home.players[0]).toMatchObject({ name: 'Marley', jerseyNumber: '', isParticipating: false, isOnCourt: false })
    expect(home.players.slice(0, 9).map((player) => player.name)).toEqual([
      'Marley', 'Stef', 'Mees', 'Maciej', 'Tim', 'Morris', 'Noud', 'Milan', 'Viggo',
    ])
    expect(home.players).toHaveLength(10)
    expect(away.players).toHaveLength(5)
  })

  it('round-trips profiles and selected teams through storage', () => {
    const storage = createStorage()
    const profiles = createDefaultTeamProfiles()
    profiles[0].coaches.push({ id: 'coach-1', name: 'Willem', role: 'coach', isParticipating: true })
    saveTeamProfiles(profiles, storage)
    saveTeamProfileSelection([profiles[0].id, profiles[1].id], storage)

    expect(storage.getItem(teamProfilesStorageKey)).not.toBeNull()
    expect(loadTeamProfiles(storage)).toEqual(profiles)
    expect(loadTeamProfileSelection(storage)).toEqual([profiles[0].id, profiles[1].id])
    expect(storage.getItem(teamProfileSelectionStorageKey)).not.toBeNull()
  })

  it('loads older saved profiles without a coaches list', () => {
    const profile = createDefaultTeamProfiles()[0]
    const { coaches: _coaches, ...legacyProfile } = profile
    expect(parseTeamProfiles([legacyProfile])[0].coaches).toEqual([])
  })

  it('migrates saved rosters to participant selection and first-name display', () => {
    const profile = createDefaultTeamProfiles()[0]
    const previousFormat = [{
      ...profile,
      players: profile.players.map((player, index) => ({
        id: player.id,
        name: index === 0 ? 'Marley van Beek' : player.name,
        jerseyNumber: player.jerseyNumber,
        isOnCourt: index === 0,
      })),
    }]

    expect(parseTeamProfiles(previousFormat)[0].players[0]).toMatchObject({
      name: 'Marley',
      isParticipating: true,
      isOnCourt: true,
    })
  })

  it('rejects malformed or duplicate team profiles', () => {
    expect(() => parseTeamProfiles([{ id: 'bad' }])).toThrow('invalid format')
    const profile = createDefaultTeamProfiles()[0]
    expect(() => parseTeamProfiles([profile, profile])).toThrow('duplicate IDs')
  })

  it('rejects a malformed saved profile selection', () => {
    const storage = createStorage()
    storage.setItem(teamProfileSelectionStorageKey, JSON.stringify(['home']))
    expect(() => loadTeamProfileSelection(storage)).toThrow('invalid format')
    storage.setItem(teamProfileSelectionStorageKey, JSON.stringify(['same', 'same']))
    expect(() => loadTeamProfileSelection(storage)).toThrow('invalid format')
  })
})
