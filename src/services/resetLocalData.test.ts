import { describe, expect, it } from 'vitest'
import { resetLocalData } from './resetLocalData'

function createStorage(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries))
  return {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    values,
  }
}

describe('resetLocalData', () => {
  it('removes all Watchtower keys without deleting unrelated data', () => {
    const storage = createStorage({
      'watchtower-game-v1': 'game',
      'other-app': 'keep',
      'watchtower-match-events-v1': 'unsynced',
      'watchtower-user-profile-v1': 'profile',
      'watchtower-locale-v1': 'nl',
      'watchtower-theme': 'dark',
    })

    resetLocalData(storage)

    expect([...storage.values.entries()]).toEqual([['other-app', 'keep']])
  })

  it('propagates storage errors', () => {
    const storage = { length: 1, key: () => 'watchtower-game-v1', removeItem: () => { throw new Error('storage blocked') } }
    expect(() => resetLocalData(storage)).toThrow('storage blocked')
  })
})
