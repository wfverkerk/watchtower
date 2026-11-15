import { describe, expect, it } from 'vitest'
import { createInitialGameState } from '../domain/game'
import { loadLocalMatches, localMatchesStorageKey, saveLocalMatch } from './localMatches'

function createStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
  }
}

describe('local match archive', () => {
  it('keeps independent games after the active game changes', () => {
    const storage = createStorage()
    const game = createInitialGameState()
    saveLocalMatch({ id: 'one', finishedAt: '2026-11-13T15:00:00Z', game }, storage)
    game.teams[0].name = 'Another team'
    saveLocalMatch({ id: 'two', finishedAt: '2026-11-13T16:00:00Z', game }, storage)
    expect(loadLocalMatches(storage).map((match) => match.game.teams[0].name)).toEqual(['Thuis', 'Another team'])
    expect(() => saveLocalMatch({ id: 'one', finishedAt: '2026-11-13T17:00:00Z', game }, storage)).toThrow('already been saved')
  })

  it('does not silently replace an invalid archive', () => {
    const storage = createStorage()
    storage.setItem(localMatchesStorageKey, '{"bad":true}')
    expect(() => saveLocalMatch({ id: 'one', finishedAt: '2026-11-13T15:00:00Z', game: createInitialGameState() }, storage)).toThrow()
    expect(storage.getItem(localMatchesStorageKey)).toBe('{"bad":true}')
  })
})
