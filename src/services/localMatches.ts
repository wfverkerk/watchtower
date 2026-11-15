import { parseGameState, type GameState } from '../domain/game'

export const localMatchesStorageKey = 'watchtower-local-matches-v1'

export type LocalMatch = {
  id: string
  finishedAt: string
  game: GameState
  submission?: { trackerId: string; targetMatchId: string | null; resultMatchId?: string }
}

type StringStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadLocalMatches(storage: StringStorage = window.localStorage): LocalMatch[] {
  const raw = storage.getItem(localMatchesStorageKey)
  if (raw === null) return []
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error('Saved local matches have an invalid format.')
  const matches = value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('Invalid local match.')
    const match = item as Record<string, unknown>
    if (typeof match.id !== 'string' || !match.id || typeof match.finishedAt !== 'string'
      || !Number.isFinite(Date.parse(match.finishedAt))) throw new Error('Invalid local match.')
    let submission: LocalMatch['submission']
    if (match.submission !== undefined) {
      if (typeof match.submission !== 'object' || match.submission === null || Array.isArray(match.submission)) throw new Error('Invalid local match submission.')
      const state = match.submission as Record<string, unknown>
      if (typeof state.trackerId !== 'string' || !(state.targetMatchId === null || typeof state.targetMatchId === 'string')
        || !(state.resultMatchId === undefined || typeof state.resultMatchId === 'string')) throw new Error('Invalid local match submission.')
      submission = { trackerId: state.trackerId, targetMatchId: state.targetMatchId, ...(typeof state.resultMatchId === 'string' ? { resultMatchId: state.resultMatchId } : {}) }
    }
    return { id: match.id, finishedAt: match.finishedAt, game: parseGameState(match.game), ...(submission ? { submission } : {}) }
  })
  if (new Set(matches.map((match) => match.id)).size !== matches.length) throw new Error('Duplicate local match ID.')
  return matches
}

export function updateLocalMatchSubmission(id: string, submission: LocalMatch['submission'], storage: StringStorage = window.localStorage) {
  const matches = loadLocalMatches(storage)
  const index = matches.findIndex((match) => match.id === id)
  if (index < 0) throw new Error('Local match not found.')
  if (submission) matches[index] = { ...matches[index], submission }
  else delete matches[index].submission
  storage.setItem(localMatchesStorageKey, JSON.stringify(matches))
}

export function saveLocalMatch(match: LocalMatch, storage: StringStorage = window.localStorage) {
  const matches = loadLocalMatches(storage)
  if (matches.some((item) => item.id === match.id)) throw new Error('This local match has already been saved.')
  const game = parseGameState(JSON.parse(JSON.stringify(match.game)))
  storage.setItem(localMatchesStorageKey, JSON.stringify([...matches, { ...match, game }]))
}
