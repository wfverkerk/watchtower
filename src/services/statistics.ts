import { parseGameState, type GameState } from '../domain/game'
import { enrichOfficialActions } from '../domain/liveReconciliation'
import { isGameAction } from './matchEventLog'
import type { LiveAction, LiveScoreLink } from './liveMatch'
import { callRpc as rpc } from './supabaseRpc'
import { isRecord } from '../domain/guards'

export type StatisticsTeam = { id: string; name: string; isCoach: boolean }
export type StatisticsPlayer = { id: string; name: string | null; jerseyNumber: string; isPrivate: boolean }
export type StatisticsMatch = {
  id: string
  finishedAt: string
  trackerId: string
  snapshotUpdatedAt: string
  game: GameState
  matchDate: string | null
  links: Record<string, string>
  canEdit: boolean
  practice: boolean
}
export type MatchScorers = {
  finishedAt: string | null
  officialTrackerId: string | null
  liveTrackerId?: string | null
  canManageLive?: boolean
  scorerId?: string | null
  scorerName?: string | null
  scorerSince?: string | null
  lastEventAt?: string | null
  canTakeOver?: boolean
  scorers: { id: string; name: string; updatedAt: string | null }[]
}

export async function joinStatisticsTeam(code: string) {
  const value = await rpc('statistics_join_team', { p_code: code.trim() })
  if (!isRecord(value) || typeof value.id !== 'string') throw new Error('Invalid team access response.')
  return value.id
}

export async function loadStatisticsTeams(): Promise<StatisticsTeam[]> {
  const value = await rpc('statistics_my_teams')
  if (!Array.isArray(value) || !value.every((team) => isRecord(team) && typeof team.id === 'string'
    && typeof team.name === 'string' && typeof team.isCoach === 'boolean')) {
    throw new Error('Invalid statistics teams response.')
  }
  return value
}

export async function loadStatisticsRoster(teamId: string): Promise<StatisticsPlayer[]> {
  const value = await rpc('statistics_roster', { p_team_id: teamId })
  if (!Array.isArray(value) || !value.every((player) => isRecord(player) && typeof player.id === 'string'
    && (player.name === null || typeof player.name === 'string')
    && typeof player.jerseyNumber === 'string' && typeof player.isPrivate === 'boolean')) {
    throw new Error('Invalid statistics roster response.')
  }
  return value
}

export async function saveStatisticsPlayer(teamId: string, playerId: string | null, name: string, number: string, isPrivate: boolean) {
  await rpc('statistics_save_player', {
    p_team_id: teamId, p_player_id: playerId, p_name: name.trim(), p_number: number, p_private: isPrivate,
  })
}

export async function loadMatchScorers(matchId: string): Promise<MatchScorers> {
  const value = await rpc('match_scorers', { p_match_id: matchId })
  const nullableString = (entry: unknown) => entry === undefined || entry === null || typeof entry === 'string'
  if (!isRecord(value) || !(value.finishedAt === null || typeof value.finishedAt === 'string')
    || !(value.officialTrackerId === null || typeof value.officialTrackerId === 'string')
    || !(value.liveTrackerId === undefined || value.liveTrackerId === null || typeof value.liveTrackerId === 'string')
    || !(value.canManageLive === undefined || typeof value.canManageLive === 'boolean')
    || !nullableString(value.scorerId) || !nullableString(value.scorerName)
    || !nullableString(value.scorerSince) || !nullableString(value.lastEventAt)
    || !(value.canTakeOver === undefined || typeof value.canTakeOver === 'boolean')
    || !Array.isArray(value.scorers) || !value.scorers.every((scorer) =>
      isRecord(scorer) && typeof scorer.id === 'string' && typeof scorer.name === 'string'
      && (scorer.updatedAt === null || typeof scorer.updatedAt === 'string'))) {
    throw new Error('Invalid match scorers response.')
  }
  return {
    finishedAt: value.finishedAt, officialTrackerId: value.officialTrackerId, scorers: value.scorers,
    ...(value.liveTrackerId !== undefined ? { liveTrackerId: value.liveTrackerId } : {}),
    ...(value.canManageLive !== undefined ? { canManageLive: value.canManageLive } : {}),
    scorerId: value.scorerId ?? null,
    scorerName: value.scorerName ?? null,
    scorerSince: value.scorerSince ?? null,
    lastEventAt: value.lastEventAt ?? null,
    ...(value.canTakeOver !== undefined ? { canTakeOver: value.canTakeOver } : {}),
  }
}

export async function restoreMyMatchSnapshot(matchId: string, initialGame: GameState) {
  const value = await rpc('my_match_snapshot', { p_match_id: matchId })
  if (value === null) return { revision: 0, game: initialGame }
  if (!isRecord(value) || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision)
    || value.revision < 1 || !isRecord(value.snapshot) || !Array.isArray(value.snapshot.players)
    || !Array.isArray(value.snapshot.actions) || !Array.isArray(value.snapshot.teams)) {
    throw new Error('Invalid scorer snapshot response.')
  }
  const restored = parseGameState({
    ...initialGame,
    teams: value.snapshot.teams.map((team: unknown) => isRecord(team)
      ? { ...team, color: initialGame.teams.find((old) => old.id === team.id)?.color ?? '#000000' } : team),
    players: value.snapshot.players.map((player: unknown) => {
      if (!isRecord(player)) return player
      const old = initialGame.players.find((item) => item.id === player.id)
      return {
        ...player,
        name: old?.name ?? `Speler ${typeof player.jerseyNumber === 'string' ? player.jerseyNumber : ''}`,
        isOnCourt: old?.isOnCourt ?? false,
        isParticipating: old?.isParticipating ?? true,
      }
    }),
    actions: value.snapshot.actions,
  })
  return { revision: value.revision, game: restored }
}

export async function finishStatisticsMatch(matchId: string, teamId: string, trackerId: string) {
  await rpc('statistics_finish_match', { p_match_id: matchId, p_team_id: teamId, p_tracker_id: trackerId })
}

export async function selectOfficialScorer(matchId: string, trackerId: string) {
  await rpc('match_select_official_scorer', { p_match_id: matchId, p_tracker_id: trackerId })
}

export async function linkStatisticsPlayer(teamId: string, matchId: string, trackerId: string, localPlayerId: string, playerId: string | null) {
  await rpc('statistics_link_player', {
    p_team_id: teamId, p_match_id: matchId, p_tracker_id: trackerId, p_local_player_id: localPlayerId, p_player_id: playerId,
  })
}

function parseContributions(value: unknown): LiveAction[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Invalid statistics contributions.')
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.trackerId !== 'string' || typeof entry.trackerName !== 'string'
      || !Array.isArray(entry.actions) || !entry.actions.every(isGameAction)) {
      throw new Error('Invalid statistics contribution.')
    }
    return entry.actions.map((action) => ({ trackerId: String(entry.trackerId), trackerName: String(entry.trackerName), action }))
  })
}

function parseScoreLinks(value: unknown, sourceId: string): LiveScoreLink[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Invalid statistics score links.')
  return value.map((link) => {
    if (!isRecord(link) || typeof link.contributorId !== 'string' || typeof link.contributorActionId !== 'string'
      || (link.mode !== 'auto' && link.mode !== 'separate' && link.mode !== 'linked')
      || !(link.sourceActionId === null || typeof link.sourceActionId === 'string')) {
      throw new Error('Invalid statistics score link.')
    }
    return { sourceId, contributorId: link.contributorId, contributorActionId: link.contributorActionId, mode: link.mode, sourceActionId: link.sourceActionId }
  })
}

export async function loadStatisticsHistory(teamId: string): Promise<StatisticsMatch[]> {
  const value = await rpc('statistics_history', { p_team_id: teamId })
  if (!Array.isArray(value)) throw new Error('Invalid statistics history response.')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.finishedAt !== 'string'
      || typeof item.trackerId !== 'string' || typeof item.snapshotUpdatedAt !== 'string'
      || typeof item.canEdit !== 'boolean' || !isRecord(item.links)
      || !(item.practice === undefined || typeof item.practice === 'boolean')
      || !(item.teamClubs === undefined || (isRecord(item.teamClubs) && Object.values(item.teamClubs).every((club) => typeof club === 'string')))
      || !Object.values(item.links).every((link) => typeof link === 'string')
      || !isRecord(item.snapshot) || !Array.isArray(item.snapshot.teams)
      || !Array.isArray(item.snapshot.players) || !Array.isArray(item.snapshot.actions)
      || !(item.snapshot.matchDate === null || typeof item.snapshot.matchDate === 'string')) {
      throw new Error('Invalid statistics match.')
    }
    const game = parseGameState({
      teams: item.snapshot.teams.map((team: unknown) => {
        if (!isRecord(team)) return team
        const club = isRecord(item.teamClubs) && typeof team.id === 'string' ? item.teamClubs[team.id] : undefined
        return { ...team, color: '#000000', ...(typeof club === 'string' ? { club } : {}) }
      }),
      players: item.snapshot.players.map((player: unknown) => isRecord(player)
        ? { ...player, name: '', isOnCourt: false } : player),
      actions: item.snapshot.actions,
      gameStarted: false,
    })
    game.actions = enrichOfficialActions(game, item.trackerId, parseContributions(item.contributions), parseScoreLinks(item.scoreLinks, item.trackerId))
    return {
      id: item.id, finishedAt: item.finishedAt, trackerId: item.trackerId,
      snapshotUpdatedAt: item.snapshotUpdatedAt, canEdit: item.canEdit,
      links: Object.fromEntries(Object.entries(item.links).map(([key, link]) => [key, String(link)])),
      game, matchDate: item.snapshot.matchDate, practice: item.practice === true,
    }
  })
}
