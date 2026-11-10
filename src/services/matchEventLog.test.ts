import { describe, expect, it } from 'vitest'
import {
  appendMatchEvents,
  loadMatchEvents,
  markMatchEventsSynced,
  matchEventsStorageKey,
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
  it('queues events locally and marks only uploaded event IDs as synced', () => {
    const storage = createStorage()
    const first = createEvent()
    const second = createEvent({
      id: 'event-2',
      actionId: 'action-2',
      action: { ...createEvent().action, id: 'action-2' },
    })

    appendMatchEvents([first, second], storage)
    markMatchEventsSynced(['event-1'], storage)

    expect(loadMatchEvents(storage)).toEqual([
      { ...first, synced: true },
      second,
    ])
    expect(storage.getItem(matchEventsStorageKey)).not.toBeNull()
  })

  it('rejects malformed saved event queues rather than silently dropping them', () => {
    const storage = createStorage()
    storage.setItem(matchEventsStorageKey, JSON.stringify([{ id: 'invalid' }]))

    expect(() => loadMatchEvents(storage)).toThrow('Saved match events have an invalid format.')
  })
})
