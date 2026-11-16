import { describe, expect, it } from 'vitest'
import { createInitialGameState } from '../domain/game'
import type { LiveEvent } from './liveMatch'
import { applyViewerEvent, applyViewerMatchRow, applyViewerStateRow, viewerActions, type ViewerMatch } from './viewerMatch'
import { buildLiveState } from './matchLiveState'

function event(id: string, trackerId: string, sequence: number): LiveEvent {
  return {
    id, trackerId, trackerName: trackerId, actionId: id, type: 'action_added', sequence,
    action: { id, playerId: 'home-1', teamId: 'home', type: 'score', value: 2, createdAt: sequence },
  }
}

function match(overrides: Partial<ViewerMatch> = {}): ViewerMatch {
  return { ownerId: 'owner', sourceId: 'live', scorerId: null, finishedAt: null, events: [], state: null, ...overrides }
}

describe('viewer match', () => {
  it('adds each event once and keeps them in the order the server received them', () => {
    const first = event('a', 'scorer', 1)
    const second = event('b', 'scorer', 2)
    const events = applyViewerEvent(applyViewerEvent([], second), first)
    expect(events.map((item) => item.id)).toEqual(['a', 'b'])
    expect(applyViewerEvent(events, first)).toBe(events)
  })

  it('follows the scorer, the finished time and the live state from realtime rows', () => {
    const state = buildLiveState(createInitialGameState())
    const updated = applyViewerStateRow(applyViewerMatchRow(match(), {
      scorer_id: 'scorer', live_tracker_id: 'scorer', finished_at: '2026-11-16T20:00:00Z',
    }), { state })
    expect(updated).toMatchObject({ scorerId: 'scorer', sourceId: 'scorer', finishedAt: '2026-11-16T20:00:00Z' })
    expect(updated.state).toEqual(state)
    expect(applyViewerMatchRow(match(), null)).toEqual(match())
  })

  it('uses the events of every scorer once a match has a scorer, and only the live tracker before that', () => {
    const game = createInitialGameState()
    const events = [event('a', 'first', 1), event('b', 'second', 2)]
    expect(viewerActions(game, match({ scorerId: 'second', sourceId: 'second', events })).map((item) => item.action.id)).toEqual(['a', 'b'])
    expect(viewerActions(game, match({ sourceId: 'second', events })).map((item) => item.action.id)).toEqual(['b'])
  })
})
