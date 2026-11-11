import type { GameAction, ShotLocation } from '../domain/game'

export const matchLinkStorageKey = 'watchtower-shared-match-v1'
export const matchEventsStorageKey = 'watchtower-match-events-v1'
export const invalidMatchEventsStorageKey = 'watchtower-match-events-recovery-v1'

export type MatchLink = {
  matchId: string
  joinCode: string
  trackerId: string
  displayName: string
}

export type MatchEventType = 'action_added' | 'action_updated' | 'action_removed'

export type MatchEvent = {
  id: string
  matchId: string
  trackerId: string
  trackerName: string
  actionId: string
  type: MatchEventType
  action: GameAction
  occurredAt: number
  synced: boolean
}

type StringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const statTypes = new Set<string>([
  'score',
  'missed_shot',
  'rebound',
  'offensive_rebound',
  'defensive_rebound',
  'assist',
  'turnover',
  'foul',
  'block',
  'steal',
])

function isShotLocation(value: unknown): value is ShotLocation {
  if (!isRecord(value)) return false
  if (value.area === 'own') return true
  return value.area === 'opponent'
    && typeof value.x === 'number'
    && Number.isFinite(value.x)
    && value.x >= 0
    && value.x <= 100
    && typeof value.y === 'number'
    && Number.isFinite(value.y)
    && value.y >= 0
    && value.y <= 100
}

function isGameAction(value: unknown): value is GameAction {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.playerId === 'string'
    && typeof value.teamId === 'string'
    && typeof value.type === 'string'
    && statTypes.has(value.type)
    && typeof value.value === 'number'
    && Number.isFinite(value.value)
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt)
    && (value.groupId === undefined || typeof value.groupId === 'string')
    && (value.shotLocation === undefined || isShotLocation(value.shotLocation))
}

function isMatchEvent(value: unknown): value is MatchEvent {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.matchId === 'string'
    && typeof value.trackerId === 'string'
    && typeof value.trackerName === 'string'
    && typeof value.actionId === 'string'
    && (value.type === 'action_added' || value.type === 'action_updated' || value.type === 'action_removed')
    && isGameAction(value.action)
    && value.actionId === value.action.id
    && typeof value.occurredAt === 'number'
    && Number.isFinite(value.occurredAt)
    && typeof value.synced === 'boolean'
}

function recoverInvalidMatchEvents(raw: string, validEvents: MatchEvent[], storage: StringStorage): MatchEvent[] {
  storage.setItem(invalidMatchEventsStorageKey, JSON.stringify({
    previous: storage.getItem(invalidMatchEventsStorageKey),
    raw,
  }))
  storage.setItem(matchEventsStorageKey, JSON.stringify(validEvents))
  console.error(`Invalid match events were preserved in ${invalidMatchEventsStorageKey}; valid events will continue.`)
  return validEvents
}

export function loadMatchLink(storage: StringStorage = window.localStorage): MatchLink | null {
  const saved = storage.getItem(matchLinkStorageKey)
  if (saved === null) return null
  const value: unknown = JSON.parse(saved)
  if (!isRecord(value)
    || typeof value.matchId !== 'string'
    || typeof value.joinCode !== 'string'
    || typeof value.trackerId !== 'string'
    || typeof value.displayName !== 'string') {
    throw new Error('Saved shared-match information has an invalid format.')
  }
  return {
    matchId: value.matchId,
    joinCode: value.joinCode,
    trackerId: value.trackerId,
    displayName: value.displayName,
  }
}

export function saveMatchLink(link: MatchLink | null, storage: StringStorage = window.localStorage) {
  if (link) storage.setItem(matchLinkStorageKey, JSON.stringify(link))
  else storage.removeItem(matchLinkStorageKey)
}

export function loadMatchEvents(storage: StringStorage = window.localStorage): MatchEvent[] {
  const saved = storage.getItem(matchEventsStorageKey)
  if (saved === null) return []
  let decoded: unknown
  try {
    decoded = JSON.parse(saved)
  } catch {
    return recoverInvalidMatchEvents(saved, [], storage)
  }
  if (!Array.isArray(decoded)) return recoverInvalidMatchEvents(saved, [], storage)

  const events = decoded.filter(isMatchEvent)
  if (events.length !== decoded.length) {
    const invalidEvents = decoded.filter((event) => !isMatchEvent(event))
    return recoverInvalidMatchEvents(JSON.stringify(invalidEvents), events, storage)
  }
  return events
}

export function saveMatchEvents(events: MatchEvent[], storage: StringStorage = window.localStorage) {
  storage.setItem(matchEventsStorageKey, JSON.stringify(events))
}

export function appendMatchEvents(events: MatchEvent[], storage: StringStorage = window.localStorage) {
  const savedEvents = loadMatchEvents(storage)
  saveMatchEvents([...savedEvents, ...events], storage)
}

export function removeMatchEvents(ids: string[], storage: StringStorage = window.localStorage) {
  const idSet = new Set(ids)
  const events = loadMatchEvents(storage).filter((event) => !idSet.has(event.id))
  saveMatchEvents(events, storage)
}

// Drops queued events that belong to a match other than the active one, so they cannot pile up.
export function discardMatchEventsExcept(matchId: string, storage: StringStorage = window.localStorage) {
  saveMatchEvents(loadMatchEvents(storage).filter((event) => event.matchId === matchId), storage)
}
