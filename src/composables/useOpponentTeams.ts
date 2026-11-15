import { ref } from 'vue'
import { loadCachedOpponentTeams, loadOpponentTeams, type OpponentTeam } from '../services/opponentTeams'

const teams = ref<OpponentTeam[]>(loadCachedOpponentTeams())
let pending: Promise<void> | null = null

async function refreshOpponentTeams() {
  if (!navigator.onLine) return
  pending ??= loadOpponentTeams()
    .then((loaded) => { teams.value = loaded })
    .catch((error) => { console.error('Failed to load the opponent teams.', error) })
    .finally(() => { pending = null })
  return pending
}

export function useOpponentTeams() {
  return { teams, refreshOpponentTeams }
}
