import { describe, expect, it, vi } from 'vitest'
import { createInitialGameState, type GameAction } from '../domain/game'
import { currentLiveActions, watchLiveMatch, type LiveEvent } from './liveMatch'

const realtime = vi.hoisted(() => ({
  loads: 0,
  handlers: [] as (() => void)[],
  status: (_status: string) => {},
  removed: vi.fn(),
}))

vi.mock('./supabaseClient', () => ({
  ensureAnonymousUser: async () => 'tracker',
  getSupabaseClient: () => {
    const builder = (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, order: () => chain,
        single: async () => { realtime.loads++; return { data: { live_tracker_id: null, owner_id: 'owner' }, error: null } },
        range: async () => ({ data: [], error: null }),
      }
      void table
      return chain
    }
    const channel = {
      on: (_type: string, _filter: unknown, callback: () => void) => { realtime.handlers.push(callback); return channel },
      subscribe: (callback: (status: string) => void) => { realtime.status = callback; return channel },
    }
    return { from: builder, channel: () => channel, removeChannel: realtime.removed }
  },
}))

function event(sequence: number, type: LiveEvent['type'], action: GameAction, trackerId = 'source'): LiveEvent {
  return { id: String(sequence), trackerId, trackerName: trackerId, actionId: action.id, type, action, sequence }
}

describe('live event replay', () => {
  it('replays edits and removals in server order without duplicating initial actions', () => {
    const game = createInitialGameState()
    const score: GameAction = { id: 'one', playerId: 'home-1', teamId: 'home', type: 'score', value: 2, createdAt: 1 }
    game.actions = [score]
    const result = currentLiveActions(game, {
      sourceId: 'source',
      ownerId: 'source',
      links: [],
      events: [
        event(3, 'action_removed', score),
        event(1, 'action_added', score),
        event(2, 'action_updated', { ...score, value: 3 }),
        event(4, 'action_added', { ...score, id: 'other' }, 'second'),
      ],
    })
    expect(result).toHaveLength(1)
    expect(result[0].trackerId).toBe('second')
    expect(result[0].action.id).toBe('other')
  })

  it('keeps the initial actions with the owner when the live scorer changes', () => {
    const game = createInitialGameState()
    const score: GameAction = { id: 'one', playerId: null, teamId: 'home', type: 'score', value: 2, createdAt: 1 }
    game.actions = [score]
    const result = currentLiveActions(game, {
      sourceId: 'new-source', ownerId: 'owner', links: [],
      events: [event(1, 'action_removed', score, 'owner')],
    })
    expect(result).toEqual([])
  })
})

describe('realtime watching', () => {
  it('reloads on subscription and notifications, reports interruptions and stops after cleanup', async () => {
    const changes = vi.fn()
    const errors = vi.fn()
    const stop = await watchLiveMatch('match', changes, errors)
    realtime.status('SUBSCRIBED')
    await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(1))
    expect(changes.mock.calls[0][0]).toMatchObject({ sourceId: 'owner', ownerId: 'owner', events: [], links: [] })

    realtime.handlers[0]()
    realtime.handlers[0]()
    await vi.waitFor(() => expect(changes.mock.calls.length).toBeGreaterThanOrEqual(2))
    await vi.waitFor(() => expect(realtime.loads).toBeLessThanOrEqual(4))

    realtime.status('CHANNEL_ERROR')
    expect(errors).toHaveBeenLastCalledWith(expect.stringContaining('interrupted'))
    realtime.status('SUBSCRIBED')
    await vi.waitFor(() => expect(errors).toHaveBeenLastCalledWith(''))

    stop()
    expect(realtime.removed).toHaveBeenCalledTimes(1)
    const calls = changes.mock.calls.length
    realtime.handlers[0]()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(changes).toHaveBeenCalledTimes(calls)
  })
})
