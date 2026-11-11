import type { GameState, Player } from '../domain/game'
import type { TeamProfile, TeamProfileCoach, TeamProfilePlayer } from './teamProfiles'

function findPlayer(players: Player[], teamId: string, id: string, coach: boolean) {
  const prefix = coach ? `${teamId}-coach-` : `${teamId}-`
  return players.find((player) => player.teamId === teamId && !!player.isCoach === coach && player.id === id)
    ?? players.find((player) => player.teamId === teamId && !!player.isCoach === coach && player.id === `${prefix}${id}`)
}

export function createGameRosterDraft(game: GameState, profile: TeamProfile): TeamProfile {
  const teamId = game.teams[0].id
  const matched = new Set<string>()
  const players = profile.players.flatMap((player) => {
    const existing = findPlayer(game.players, teamId, player.id, false)
    if (existing && matched.has(existing.id)) return []
    if (!existing && findPlayer(game.players, teamId, player.id, true)) return []
    if (existing) matched.add(existing.id)
    return [{
      ...player,
      ...(existing ? { name: existing.name, jerseyNumber: existing.jerseyNumber } : {}),
      isParticipating: !!existing && existing.isParticipating !== false,
      isOnCourt: existing?.isOnCourt ?? false,
    }]
  })
  const coaches = profile.coaches.flatMap((coach) => {
    const existing = findPlayer(game.players, teamId, coach.id, true)
    if (existing && matched.has(existing.id)) return []
    if (existing) matched.add(existing.id)
    return [{
      ...coach,
      ...(existing ? { name: existing.name, role: existing.coachRole ?? 'coach' } : {}),
      isParticipating: !!existing && existing.isParticipating !== false,
    }]
  })
  for (const player of game.players.filter((item) => item.teamId === teamId && !matched.has(item.id))) {
    if (player.isCoach) {
      coaches.push({ id: player.id, name: player.name, role: player.coachRole ?? 'coach', isParticipating: player.isParticipating !== false })
    } else {
      players.push({ id: player.id, name: player.name, jerseyNumber: player.jerseyNumber, isParticipating: player.isParticipating !== false, isOnCourt: player.isOnCourt })
    }
  }
  return { ...profile, players, coaches }
}

export function applyGameRoster(game: GameState, profile: TeamProfile): Player[] {
  const teamId = game.teams[0].id
  const updated = game.players.map((player) => ({ ...player }))
  const applyPerson = (person: TeamProfilePlayer | TeamProfileCoach, coach: boolean) => {
    const existing = findPlayer(updated, teamId, person.id, coach)
    if (!existing && !person.isParticipating) return
    const player: Player = existing ?? {
      id: `${teamId}-${coach ? 'coach-' : ''}${person.id}`,
      name: person.name.trim(),
      teamId,
      jerseyNumber: '',
      isOnCourt: false,
    }
    if (!existing) updated.push(player)
    player.name = person.name.trim() || player.name
    player.isParticipating = person.isParticipating
    if (!person.isParticipating) player.isOnCourt = false
    if ('jerseyNumber' in person) player.jerseyNumber = person.jerseyNumber || player.jerseyNumber
    else {
      player.isCoach = true
      player.coachRole = person.role
    }
  }
  profile.players.forEach((player) => applyPerson(player, false))
  profile.coaches.forEach((coach) => applyPerson(coach, true))
  return updated
}
