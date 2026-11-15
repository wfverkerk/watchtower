import { parseGameState, type GameAction, type GameState } from '../domain/game'
import { errorMessage, isRecord } from '../domain/guards'

export const matchSnapshotsStorageKey = 'watchtower-match-snapshots-v1'

export type MatchSnapshot = {
  matchId: string
  trackerId: string
  revision: number
  baseRevision: number
  teams: { id: string; name: string }[]
  players: { id: string; teamId: string; jerseyNumber: string; statisticsPrivate: boolean }[]
  actions: GameAction[]
  matchDate: string | null
  catalogTeamId: string | null
}

type SnapshotStore = { revisions: Record<string, number>; bases: Record<string, number>; pending: MatchSnapshot[] }
type StringStorage = Pick<Storage, 'getItem' | 'setItem'>

function validSnapshot(value: unknown) {
  if (!isRecord(value) || typeof value.matchId !== 'string' || typeof value.trackerId !== 'string'
    || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.baseRevision)
    || Number(value.baseRevision) < 0 || Number(value.revision) <= Number(value.baseRevision)
    || !Array.isArray(value.teams) || !Array.isArray(value.players) || !Array.isArray(value.actions)
    || !(value.matchDate === null || (typeof value.matchDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.matchDate)))
    || !(value.catalogTeamId === undefined || value.catalogTeamId === null || typeof value.catalogTeamId === 'string')
    || !value.teams.every((team) => isRecord(team) && typeof team.id === 'string' && typeof team.name === 'string')
    || !value.players.every((player) => isRecord(player) && typeof player.id === 'string'
      && typeof player.teamId === 'string' && typeof player.jerseyNumber === 'string'
      && typeof player.statisticsPrivate === 'boolean' && !('name' in player))) return false
  try {
    parseGameState({
      teams: value.teams.map((team) => ({ ...team, color: '#000000' })),
      players: value.players.map((player) => ({ ...player, name: '', isOnCourt: false })),
      actions: value.actions,
      gameStarted: false,
    })
    return true
  } catch {
    return false
  }
}

function loadStore(storage: StringStorage): SnapshotStore {
  const raw = storage.getItem(matchSnapshotsStorageKey)
  if (raw === null) return { revisions: {}, bases: {}, pending: [] }
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || !isRecord(value.revisions) || !isRecord(value.bases) || !Array.isArray(value.pending)
    || !Object.values(value.revisions).every((revision) => Number.isSafeInteger(revision) && Number(revision) >= 0)
    || !Object.values(value.bases).every((revision) => Number.isSafeInteger(revision) && Number(revision) >= 0)
    || !value.pending.every(validSnapshot)) {
    throw new Error('Saved match snapshots have an invalid format.')
  }
  const store = value as SnapshotStore
  return {
    ...store,
    pending: store.pending.map((snapshot) => ({ ...snapshot, catalogTeamId: snapshot.catalogTeamId ?? null })),
  }
}

export function queueMatchSnapshot(matchId: string, trackerId: string, game: GameState, storage: StringStorage = window.localStorage) {
  const store = loadStore(storage)
  const key = `${matchId}:${trackerId}`
  const revision = (store.revisions[key] ?? 0) + 1
  const snapshot: MatchSnapshot = {
    matchId,
    trackerId,
    revision,
    baseRevision: store.bases[key] ?? 0,
    teams: game.teams.map(({ id, name }) => ({ id, name })),
    players: game.players.map(({ id, teamId, jerseyNumber, statisticsPrivate }) => ({
      id, teamId, jerseyNumber, statisticsPrivate: !!statisticsPrivate,
    })),
    actions: game.actions.map((action) => ({ ...action })),
    matchDate: game.matchInfo?.date ?? null,
    catalogTeamId: game.catalogTeamId ?? null,
  }
  store.revisions[key] = revision
  store.pending = store.pending.filter((item) => item.matchId !== matchId || item.trackerId !== trackerId)
  store.pending.push(snapshot)
  storage.setItem(matchSnapshotsStorageKey, JSON.stringify(store))
}

export function setMatchSnapshotBase(matchId: string, trackerId: string, revision: number, storage: StringStorage = window.localStorage) {
  const store = loadStore(storage)
  if (store.pending.some((snapshot) => snapshot.matchId === matchId && snapshot.trackerId === trackerId)) {
    throw new Error('Pending snapshots must be synchronized before rejoining this match.')
  }
  const key = `${matchId}:${trackerId}`
  store.bases[key] = revision
  store.revisions[key] = revision
  storage.setItem(matchSnapshotsStorageKey, JSON.stringify(store))
}

export function loadPendingMatchSnapshots(storage: StringStorage = window.localStorage) {
  return loadStore(storage).pending
}

export async function syncQueuedMatchSnapshots(
  trackerId: string,
  upload: (snapshot: MatchSnapshot) => Promise<void>,
  storage: StringStorage = window.localStorage,
) {
  const snapshots = loadPendingMatchSnapshots(storage)
  const failures: unknown[] = []
  for (const snapshot of snapshots.filter((item) => item.trackerId === trackerId)) {
    try {
      await upload(snapshot)
      const store = loadStore(storage)
      const key = `${snapshot.matchId}:${snapshot.trackerId}`
      store.bases[key] = snapshot.revision
      store.pending = store.pending.filter((item) =>
        item.matchId !== snapshot.matchId || item.trackerId !== snapshot.trackerId || item.revision !== snapshot.revision)
      const newer = store.pending.find((item) => item.matchId === snapshot.matchId && item.trackerId === snapshot.trackerId)
      if (newer) newer.baseRevision = snapshot.revision
      storage.setItem(matchSnapshotsStorageKey, JSON.stringify(store))
    } catch (error) {
      failures.push(error)
    }
  }
  if (snapshots.some((item) => item.trackerId !== trackerId)) {
    failures.push(new Error('Queued match snapshots belong to a different tracker.'))
  }
  if (failures.length) {
    throw new AggregateError(failures, failures.map((error) => errorMessage(error)).join('; '))
  }
}
