import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialGameState } from '../domain/game'
import { loadLocalMatches, saveLocalMatch } from './localMatches'
import { submitLocalMatch } from './submitLocalMatch'

const api = vi.hoisted(() => ({ rpc: vi.fn(), identity: vi.fn() }))
vi.mock('./supabaseClient', () => ({
  getSupabaseClient: () => ({ rpc: api.rpc }),
  ensureAnonymousUser: api.identity,
}))

function createStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
  }
}

function archive(storage: ReturnType<typeof createStorage>) {
  const game = createInitialGameState()
  game.matchInfo = { id: 'manual-1', date: '2026-11-13', startTime: '12:00', venue: '', startsAt: '2026-11-13T11:00:00Z' }
  saveLocalMatch({ id: 'local', finishedAt: '2026-11-13T14:00:00Z', game }, storage)
}

beforeEach(() => {
  vi.resetAllMocks()
  api.identity.mockResolvedValue('tracker')
})

describe('offline submission', () => {
  it('retains the original identity and target after an uncertain network failure', async () => {
    const storage = createStorage()
    archive(storage)
    api.rpc.mockRejectedValueOnce(new Error('offline'))
    await expect(submitLocalMatch('local', 'match', 'Scorer', storage)).rejects.toThrow('offline')
    expect(loadLocalMatches(storage)[0].submission).toEqual({ trackerId: 'tracker', targetMatchId: 'match' })
    await expect(submitLocalMatch('local', 'other', 'Scorer', storage)).rejects.toThrow('original account and target')
    api.rpc.mockResolvedValueOnce({ data: { match_id: 'match' }, error: null })
    await expect(submitLocalMatch('local', 'match', 'Scorer', storage)).resolves.toBe('match')
    expect(loadLocalMatches(storage)[0].submission?.resultMatchId).toBe('match')
  })

  it('allows another target after a confirmed database rejection', async () => {
    const storage = createStorage()
    archive(storage)
    api.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'metadata mismatch' } })
    await expect(submitLocalMatch('local', 'match', 'Scorer', storage)).rejects.toThrow('metadata mismatch')
    expect(loadLocalMatches(storage)[0].submission).toBeUndefined()
  })
})
