import { describe, expect, it } from 'vitest'
import { loadUserProfile, parseUserProfile, saveUserProfile, userProfileStorageKey } from './userProfile'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('user profile storage', () => {
  it('loads no profile on first use and saves name, description, and language', () => {
    const storage = createStorage()
    const profile = { name: 'Jamie', description: 'Vader Jamie', locale: 'nl' as const }

    expect(loadUserProfile(storage)).toBeNull()
    saveUserProfile(profile, storage)
    expect(storage.getItem(userProfileStorageKey)).not.toBeNull()
    expect(loadUserProfile(storage)).toEqual(profile)
  })

  it('rejects invalid names and locales', () => {
    expect(() => parseUserProfile({ name: ' ', locale: 'nl' })).toThrow('invalid format')
    expect(() => parseUserProfile({ name: 'Jamie', locale: 'fr' })).toThrow('invalid format')
  })

  it('supports old profiles without a description and rejects an overlong description', () => {
    expect(parseUserProfile({ name: 'Jamie', favoriteTeamIds: ['x12-1'], locale: 'nl' })).toEqual({
      name: 'Jamie',
      description: '',
      locale: 'nl',
    })
    expect(() => parseUserProfile({
      name: 'Jamie',
      description: 'x'.repeat(121),
      locale: 'nl',
    })).toThrow('invalid format')
  })
})
