import { ref } from 'vue'

const storageKey = 'watchtower-favorite-teams-v1'

function readFavorites(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch (reason) {
    console.error('Failed to read favorite teams.', reason)
    return []
  }
}

const favorites = ref<string[]>(readFavorites())

export function useFavoriteTeams() {
  function isFavorite(teamName: string) {
    return favorites.value.includes(teamName)
  }

  function setFavorites(teamNames: string[]) {
    favorites.value = [...new Set(teamNames)]
    window.localStorage.setItem(storageKey, JSON.stringify(favorites.value))
  }

  return { favorites, isFavorite, setFavorites }
}
