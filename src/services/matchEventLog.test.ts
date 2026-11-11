import { describe, expect, it } from 'vitest'
import {
  appendMatchEvents,
  discardMatchEventsExcept,
  invalidMatchEventsStorageKey,
  loadMatchEvents,
  matchEventsStorageKey,
  removeMatchEvents,
  type MatchEvent,
} from './matchEventLog'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

function createEvent(overrides: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: 'event-1',
    matchId: 'match-1',
    trackerId: 'tracker-1',
    trackerName: 'Scorer 1',
    actionId: 'action-1',
    type: 'action_added',
    action: {
      id: 'action-1',
      playerId: 'home-1',
      teamId: 'home',
      type: 'score',
      value: 2,
      createdAt: 1_700_000_000_000,
    },
    occurredAt: 1_700_000_000_001,
    synced: false,
    ...overrides,
  }
}

describe('shared match event log', () => {
  it('queues events locally and removes only uploaded event IDs after confirmation', () => {
    const storage = createStorage()
    const first = createEvent()
    const second = createEvent({
      id: 'event-2',
      actionId: 'action-2',
      action: { ...createEvent().action, id: 'action-2' },
    })

    appendMatchEvents([first, second], storage)
    removeMatchEvents(['event-1'], storage)

    expect(loadMatchEvents(storage)).toEqual([second])
    expect(storage.getItem(matchEventsStorageKey)).not.toBeNull()
  })

  it('preserves malformed events and keeps valid events available for the next operation', () => {
    const storage = createStorage()
    const valid = createEvent()
    const corruptQueue = JSON.stringify([valid, { id: 'invalid' }])
    storage.setItem(matchEventsStorageKey, corruptQueue)

    expect(loadMatchEvents(storage)).toEqual([valid])
    expect(JSON.parse(JSON.parse(storage.getItem(invalidMatchEventsStorageKey) ?? '{}').raw)).toEqual([{ id: 'invalid' }])
    expect(loadMatchEvents(storage)).toEqual([valid])
  })

  it('recovers from invalid JSON without discarding the original queue', () => {
    const storage = createStorage()
    storage.setItem(matchEventsStorageKey, '[invalid')

    expect(loadMatchEvents(storage)).toEqual([])
    expect(JSON.parse(storage.getItem(invalidMatchEventsStorageKey) ?? '{}').raw).toBe('[invalid')
    expect(loadMatchEvents(storage)).toEqual([])
  })

  it('discards events that belong to other matches', () => {
    const storage = createStorage()
    appendMatchEvents([
      createEvent({ id: 'old', matchId: 'match-old' }),
      createEvent({ id: 'current', matchId: 'match-1' }),
    ], storage)

    discardMatchEventsExcept('match-1', storage)

    expect(loadMatchEvents(storage).map((event) => event.id)).toEqual(['current'])
  })
})
