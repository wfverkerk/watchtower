import { describe, expect, it, vi } from 'vitest'
import { createInitialGameState } from '../domain/game'
import { loadPendingMatchSnapshots, matchSnapshotsStorageKey, queueMatchSnapshot, syncQueuedMatchSnapshots } from './matchSnapshots'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('match snapshots', () => {
  it('omits player names and preserves the latest revision across matches', () => {
    const storage = createStorage()
    const game = createInitialGameState()
    game.players[0].name = 'Private name'
    queueMatchSnapshot('first', 'tracker', game, storage)
    const revision = loadPendingMatchSnapshots(storage)[0].revision
    queueMatchSnapshot('first', 'tracker', game, storage)
    queueMatchSnapshot('second', 'tracker', game, storage)
    const snapshots = loadPendingMatchSnapshots(storage)
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].revision).toBeGreaterThan(revision)
    expect(JSON.stringify(snapshots)).not.toContain('Private name')
  })

  it('does not remove a newer snapshot created while an upload is in progress', async () => {
    const storage = createStorage()
    const game = createInitialGameState()
    queueMatchSnapshot('match', 'tracker', game, storage)
    const upload = vi.fn(async () => { queueMatchSnapshot('match', 'tracker', game, storage) })
    await syncQueuedMatchSnapshots('tracker', upload, storage)
    expect(loadPendingMatchSnapshots(storage)).toHaveLength(1)
    expect(loadPendingMatchSnapshots(storage)[0].baseRevision).toBe(1)
  })

  it('retains queued snapshots saved before team identity was added', () => {
    const storage = createStorage()
    queueMatchSnapshot('match', 'tracker', createInitialGameState(), storage)
    const store = JSON.parse(storage.getItem(matchSnapshotsStorageKey)!)
    delete store.pending[0].catalogTeamId
    storage.setItem(matchSnapshotsStorageKey, JSON.stringify(store))
    expect(loadPendingMatchSnapshots(storage)[0]).toMatchObject({ matchId: 'match', catalogTeamId: null })
  })

  it('preserves failed and other tracker snapshots', async () => {
    const storage = createStorage()
    const game = createInitialGameState()
    queueMatchSnapshot('failed', 'tracker', game, storage)
    queueMatchSnapshot('other', 'other-tracker', game, storage)
    await expect(syncQueuedMatchSnapshots('tracker', async () => { throw new Error('offline') }, storage))
      .rejects.toThrow('offline')
    expect(loadPendingMatchSnapshots(storage)).toHaveLength(2)
  })

  it('continues syncing other matches after a snapshot fails', async () => {
    const storage = createStorage()
    const game = createInitialGameState()
    queueMatchSnapshot('old', 'tracker', game, storage)
    queueMatchSnapshot('current', 'tracker', game, storage)
    const upload = vi.fn(async (snapshot: { matchId: string }) => {
      if (snapshot.matchId === 'old') throw new Error('conflict')
    })
    await expect(syncQueuedMatchSnapshots('tracker', upload, storage)).rejects.toThrow('conflict')
    expect(upload).toHaveBeenCalledTimes(2)
    expect(loadPendingMatchSnapshots(storage).map((snapshot) => snapshot.matchId)).toEqual(['old'])
  })
})
