import { parseGameState, type GameState } from '../domain/game'
import type { AppLocale } from '../i18n/types'

export const gameStorageKey = 'watchtower-game-v1'

type GameStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadGameState(
  locale: AppLocale = 'nl',
  storage: GameStorage = window.localStorage,
): GameState | null {
  const savedState = storage.getItem(gameStorageKey)
  return savedState === null ? null : parseGameState(JSON.parse(savedState) as unknown, locale)
}

export function saveGameState(game: GameState, storage: GameStorage = window.localStorage) {
  storage.setItem(gameStorageKey, JSON.stringify(game))
}
