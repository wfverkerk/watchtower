import type { GameState, Player } from '../domain/game'
import type { TeamProfile, TeamProfilePlayer } from './teamProfiles'

function findPlayer(players: Player[], teamId: string, id: string) {
  return players.find((player) => player.teamId === teamId && player.id === id)
    ?? players.find((player) => player.teamId === teamId && player.id === `${teamId}-${id}`)
}

export function createGameRosterDraft(game: GameState, profile: TeamProfile): TeamProfile {
  const teamId = game.teams[0].id
  const matched = new Set<string>()
  const players = profile.players.flatMap((player) => {
    const existing = findPlayer(game.players, teamId, player.id)
    if (existing && matched.has(existing.id)) return []
    if (existing) matched.add(existing.id)
    return [{
      ...player,
      ...(existing ? { name: existing.name, jerseyNumber: existing.jerseyNumber } : {}),
      ...(existing?.statisticsPrivate ? { statisticsPrivate: true } : {}),
      isParticipating: !!existing && existing.isParticipating !== false,
      isOnCourt: existing?.isOnCourt ?? false,
    }]
  })
  for (const player of game.players.filter((item) => item.teamId === teamId && !matched.has(item.id))) {
    players.push({ id: player.id, name: player.name, jerseyNumber: player.jerseyNumber, isParticipating: player.isParticipating !== false, isOnCourt: player.isOnCourt, ...(player.statisticsPrivate ? { statisticsPrivate: true } : {}) })
  }
  return { ...profile, players }
}

export function applyGameRoster(game: GameState, profile: TeamProfile): Player[] {
  const teamId = game.teams[0].id
  const updated = game.players.map((player) => ({ ...player }))
  const applyPlayer = (person: TeamProfilePlayer) => {
    const existing = findPlayer(updated, teamId, person.id)
    if (!existing && !person.isParticipating) return
    const player: Player = existing ?? {
      id: `${teamId}-${person.id}`,
      name: person.name.trim(),
      teamId,
      jerseyNumber: '',
      isOnCourt: false,
    }
    if (!existing) updated.push(player)
    player.name = (person.statisticsPrivate || player.statisticsPrivate)
      ? `Speler ${person.jerseyNumber || player.jerseyNumber}`
      : person.name.trim() || player.name
    player.isParticipating = person.isParticipating
    if (!person.isParticipating) player.isOnCourt = false
    player.jerseyNumber = person.jerseyNumber || player.jerseyNumber
    if (person.statisticsPrivate) player.statisticsPrivate = true
  }
  profile.players.forEach(applyPlayer)
  return updated
}
