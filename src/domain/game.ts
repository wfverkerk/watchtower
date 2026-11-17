import type { AppLocale } from '../i18n/types'
import { foulPeriodGroup, type GameClock } from './gameClock'
import { parseMatchTimeline, type MatchTimelineEvent } from './matchTimeline'
import { isRecord } from './guards'

export type StatType =
  | 'score'
  | 'missed_shot'
  | 'rebound'
  | 'offensive_rebound'
  | 'defensive_rebound'
  | 'assist'
  | 'turnover'
  | 'foul'
  | 'block'
  | 'steal'
export type FoulType = 'P' | 'U' | 'T' | 'D' | 'C' | 'B' | 'BD'
export type TurnoverType =
  | 'turnover'
  | 'second_dribble'
  | 'travel'
  | 'three_seconds'
  | 'eight_seconds'
  | 'five_seconds'
  | 'backcourt_violation'
  | 'carry'
  | 'out_of_bounds'
  | 'kicked_ball'

// club is set when the team name alone does not identify the club, such as a typed practice opponent.
export type Team = { id: string; name: string; color: string; club?: string; zoebas?: boolean }
export type Player = {
  id: string
  name: string
  teamId: string
  jerseyNumber: string
  isOnCourt: boolean
  isParticipating?: boolean
  statisticsPrivate?: boolean
}

// A coach is no longer a team member. Fouls can still be assigned to one fixed coach per team, with the id coach-<teamId>.
export function foulCoachId(teamId: string) {
  return `coach-${teamId}`
}

export function isFoulCoachId(playerId: string | null) {
  return playerId !== null && playerId.startsWith('coach-')
}

export type ShotLocation =
  | { area: 'opponent'; x: number; y: number }
  | { area: 'own' }
export type GameAction = {
  id: string
  playerId: string | null
  teamId: string
  type: StatType
  value: number
  createdAt: number
  groupId?: string
  shotLocation?: ShotLocation
  foulType?: FoulType
  turnoverType?: TurnoverType
  period?: number
}
export type GameMatchInfo = {
  id: string
  date: string
  startTime: string
  venue: string
  startsAt?: string
  // Practice games are set up by hand, outside the schedule, and have no session window.
  kind?: 'practice'
}
export type GameState = {
  teams: Team[]
  players: Player[]
  actions: GameAction[]
  gameStarted: boolean
  localMatchId?: string
  localFinishedAt?: string
  matchInfo?: GameMatchInfo
  catalogTeamId?: string
  period?: number
  youth?: boolean
  clock?: GameClock
  timeline?: MatchTimelineEvent[]
}
export type TeamStats = {
  teamId: string
  offensiveRebounds: number
  defensiveRebounds: number
  legacyRebounds: number
  assists: number
  turnovers: number
  fouls: number
  blocks: number
  steals: number
  missedShots: number
}
export type RecentAction = { action: GameAction; assistName: string; personalFoulNumber?: number }

const statTypes: StatType[] = [
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
]
const foulTypes: FoulType[] = ['P', 'U', 'T', 'D', 'C', 'B', 'BD']
export const turnoverTypes = [
  'turnover',
  'second_dribble',
  'travel',
  'three_seconds',
  'eight_seconds',
  'five_seconds',
  'backcourt_violation',
  'carry',
  'out_of_bounds',
  'kicked_ball',
] as const satisfies readonly TurnoverType[]

export function createInitialGameState(locale: AppLocale = 'nl'): GameState {
  const names = {
    nl: { home: 'Thuis', away: 'Uit', player: 'Speler' },
    en: { home: 'Home', away: 'Away', player: 'Player' },
    cs: { home: 'Domácí', away: 'Hosté', player: 'Hráč' },
  }[locale]
  const teams: Team[] = [
    { id: 'home', name: names.home, color: '#f26a36' },
    { id: 'away', name: names.away, color: '#5d72d9' },
  ]
  const players = teams.flatMap((team) =>
    Array.from({ length: 5 }, (_, index): Player => ({
      id: `${team.id}-${index + 1}`,
      name: `${names.player} ${index + 1}`,
      teamId: team.id,
      jerseyNumber: String(index + 1),
      isOnCourt: true,
    })),
  )

  return { teams, players, actions: [], gameStarted: false }
}

function isStatType(value: unknown): value is StatType {
  return typeof value === 'string' && statTypes.includes(value as StatType)
}

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

// Legacy saves used TF for a technical foul.
function parseFoulType(value: unknown): FoulType | undefined {
  if (value === 'TF') return 'T'
  return foulTypes.find((foulType) => foulType === value)
}

export function isTurnoverType(value: unknown): value is TurnoverType {
  return (turnoverTypes as readonly unknown[]).includes(value)
}

function isUnusedLegacyDemoRoster(players: unknown[], actions: unknown[]) {
  return actions.length === 0
    && players.length === 10
    && players.every((player, index) => {
      if (!isRecord(player)) return false
      return player.id === `${index < 5 ? 'h' : 'a'}${index % 5 + 1}`
        && player.name === `Speler ${(index % 5) + 1}`
    })
}

export function parseGameState(value: unknown, locale: AppLocale = 'nl'): GameState {
  if (!isRecord(value)
    || !Array.isArray(value.teams)
    || !Array.isArray(value.players)
    || !Array.isArray(value.actions)
    || typeof value.gameStarted !== 'boolean') {
    throw new Error('Opgeslagen wedstrijdgegevens hebben een ongeldig formaat.')
  }

  const teams = value.teams.map((team): Team => {
    if (!isRecord(team)
      || typeof team.id !== 'string'
      || typeof team.name !== 'string'
      || typeof team.color !== 'string'
      || (team.club !== undefined && typeof team.club !== 'string')
      || (team.zoebas !== undefined && typeof team.zoebas !== 'boolean')) {
      throw new Error('Opgeslagen teamgegevens zijn ongeldig.')
    }
    return { id: team.id, name: team.name, color: team.color, ...(team.club ? { club: team.club } : {}), ...(team.zoebas ? { zoebas: true } : {}) }
  })
  if (teams.length !== 2 || new Set(teams.map((team) => team.id)).size !== 2) {
    throw new Error('Een wedstrijd moet precies twee verschillende teams hebben.')
  }

  // Legacy saves can contain coaches as players; they are dropped and their fouls move to the team's fixed coach.
  const legacyCoachIds = new Map<string, string>()
  for (const player of value.players) {
    if (isRecord(player) && player.isCoach === true && typeof player.id === 'string' && typeof player.teamId === 'string') {
      legacyCoachIds.set(player.id, foulCoachId(player.teamId))
    }
  }
  const rawPlayers = value.players.filter((player) => !(isRecord(player) && player.isCoach === true))
  const rawActions = value.actions.map((action) => isRecord(action) && typeof action.playerId === 'string' && legacyCoachIds.has(action.playerId)
    ? { ...action, playerId: legacyCoachIds.get(action.playerId) }
    : action)
  if (value.period === undefined && value.youth === undefined && value.clock === undefined && isUnusedLegacyDemoRoster(rawPlayers, rawActions)) {
    return {
      ...createInitialGameState(locale),
      teams,
      gameStarted: value.gameStarted,
      ...(isGameMatchInfo(value.matchInfo) ? { matchInfo: value.matchInfo } : {}),
    }
  }

  const courtCounts = new Map<string, number>()
  const players = rawPlayers.map((player): Player => {
    if (!isRecord(player)
      || typeof player.id !== 'string'
      || typeof player.name !== 'string'
      || typeof player.teamId !== 'string'
      || (player.statisticsPrivate !== undefined && typeof player.statisticsPrivate !== 'boolean')
      || (player.isParticipating !== undefined && typeof player.isParticipating !== 'boolean')
      || !teams.some((team) => team.id === player.teamId)) {
      throw new Error('Opgeslagen spelersgegevens zijn ongeldig.')
    }

    const activeCount = courtCounts.get(player.teamId) ?? 0
    const requestedOnCourt = typeof player.isOnCourt === 'boolean' ? player.isOnCourt : activeCount < 5
    const isOnCourt = requestedOnCourt && player.isParticipating !== false && activeCount < 5
    if (isOnCourt) courtCounts.set(player.teamId, activeCount + 1)

    return {
      id: player.id,
      name: player.name,
      teamId: player.teamId,
      jerseyNumber: typeof player.jerseyNumber === 'string' ? player.jerseyNumber : '',
      isOnCourt,
      ...(player.isParticipating === false ? { isParticipating: false } : {}),
      ...(player.statisticsPrivate === true ? { statisticsPrivate: true } : {}),
    }
  })

  const actions = rawActions.map((action): GameAction => {
    if (!isRecord(action)
      || typeof action.id !== 'string'
      || (typeof action.playerId !== 'string' && !(action.playerId === null && ((action.type === 'score' && action.teamId === teams[1].id) || isReboundType(action.type))))
      || typeof action.teamId !== 'string'
      || !teams.some((team) => team.id === action.teamId)
      || !isStatType(action.type)
      || typeof action.value !== 'number'
      || !Number.isFinite(action.value)
      || typeof action.createdAt !== 'number'
      || !Number.isFinite(action.createdAt)
      || (action.groupId !== undefined && typeof action.groupId !== 'string')
      || (action.shotLocation !== undefined && !isShotLocation(action.shotLocation))
      || (action.period !== undefined && (typeof action.period !== 'number' || !Number.isSafeInteger(action.period) || action.period < 1))
      || (action.foulType !== undefined && (action.type !== 'foul' || parseFoulType(action.foulType) === undefined))
      || (action.turnoverType !== undefined && (action.type !== 'turnover' || !isTurnoverType(action.turnoverType)))) {
      throw new Error('Opgeslagen wedstrijdacties zijn ongeldig.')
    }

    return {
      id: action.id,
      playerId: action.playerId,
      teamId: action.teamId,
      type: action.type,
      value: action.value,
      createdAt: action.createdAt,
      ...(typeof action.groupId === 'string' ? { groupId: action.groupId } : {}),
      ...(isShotLocation(action.shotLocation) ? { shotLocation: action.shotLocation } : {}),
      ...(parseFoulType(action.foulType) ? { foulType: parseFoulType(action.foulType) } : {}),
      ...(isTurnoverType(action.turnoverType) ? { turnoverType: action.turnoverType } : {}),
      ...(typeof action.period === 'number' ? { period: action.period } : {}),
    }
  })

  if (value.matchInfo !== undefined && !isGameMatchInfo(value.matchInfo)) {
    throw new Error('Opgeslagen wedstrijdinformatie is ongeldig.')
  }
  if (value.catalogTeamId !== undefined && typeof value.catalogTeamId !== 'string') {
    throw new Error('Opgeslagen teamidentiteit is ongeldig.')
  }
  if ((value.localMatchId !== undefined && (typeof value.localMatchId !== 'string' || !value.localMatchId))
    || (value.localFinishedAt !== undefined && (typeof value.localFinishedAt !== 'string'
      || !Number.isFinite(Date.parse(value.localFinishedAt)) || typeof value.localMatchId !== 'string'))) {
    throw new Error('Opgeslagen lokale wedstrijdidentiteit is ongeldig.')
  }
  if (value.period !== undefined && (typeof value.period !== 'number' || !Number.isSafeInteger(value.period) || value.period < 0)) {
    throw new Error('Opgeslagen periode is ongeldig.')
  }
  if (value.youth !== undefined && typeof value.youth !== 'boolean') {
    throw new Error('Opgeslagen wedstrijdtype is ongeldig.')
  }
  if (value.clock !== undefined && (!isRecord(value.clock)
    || (value.clock.phase !== 'period' && value.clock.phase !== 'halftime')
    || typeof value.clock.remainingMs !== 'number' || !Number.isFinite(value.clock.remainingMs) || value.clock.remainingMs < 0
    || (value.clock.deadline !== null && (typeof value.clock.deadline !== 'number' || !Number.isFinite(value.clock.deadline))))) {
    throw new Error('Opgeslagen wedstrijdklok is ongeldig.')
  }
  return {
    teams,
    players,
    actions,
    gameStarted: value.gameStarted,
    ...(typeof value.localMatchId === 'string' ? { localMatchId: value.localMatchId } : {}),
    ...(typeof value.localFinishedAt === 'string' ? { localFinishedAt: value.localFinishedAt } : {}),
    ...(isGameMatchInfo(value.matchInfo) ? { matchInfo: value.matchInfo } : {}),
    ...(typeof value.catalogTeamId === 'string' ? { catalogTeamId: value.catalogTeamId } : {}),
    ...(typeof value.period === 'number' ? { period: value.period } : {}),
    ...(typeof value.youth === 'boolean' ? { youth: value.youth } : {}),
    ...(isRecord(value.clock) ? { clock: value.clock as GameClock } : {}),
    ...(value.timeline !== undefined ? { timeline: parseMatchTimeline(value.timeline) } : {}),
  }
}

function isGameMatchInfo(value: unknown): value is GameMatchInfo {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && typeof value.startTime === 'string'
    && /^\d{2}:\d{2}$/.test(value.startTime)
    && typeof value.venue === 'string'
    && (value.startsAt === undefined || (typeof value.startsAt === 'string' && Number.isFinite(Date.parse(value.startsAt))))
    && (value.kind === undefined || value.kind === 'practice')
}

export function fullTeamName(team: Pick<Team, 'name' | 'club'>) {
  return team.club && team.club !== team.name ? `${team.club} ${team.name}` : team.name
}

export function isPracticeGame(game: Pick<GameState, 'matchInfo'>) {
  return game.matchInfo?.kind === 'practice'
}

export function canStartGame(game: GameState) {
  return game.teams.every((team) => {
    const teamPlayers = game.players.filter((player) => player.teamId === team.id && player.isParticipating !== false)
    const active = teamPlayers.filter((player) => player.isOnCourt).length
    return active >= 2 && active <= 5
      && teamPlayers.every((player) => player.jerseyNumber !== '')
  })
}

export function startNextPeriod(game: GameState, playerIds: string[]) {
  const players = game.players.filter((player) => player.teamId === game.teams[0].id && player.isParticipating !== false)
  const selected = new Set(playerIds)
  if (selected.size < 2 || selected.size > 5 || selected.size !== playerIds.length || !playerIds.every((id) => players.some((player) => player.id === id))) {
    return false
  }
  for (const player of players) player.isOnCourt = selected.has(player.id)
  game.period = (game.period ?? 1) + 1
  game.gameStarted = true
  return true
}

// Personal fouls (P) count toward the five-foul limit of a field player.
export function getPlayerFouls(actions: GameAction[]) {
  const counts: Record<string, number> = Object.create(null)
  for (const action of actions) {
    if (action.type === 'foul' && action.foulType === 'P' && action.playerId !== null) counts[action.playerId] = (counts[action.playerId] ?? 0) + 1
  }
  return counts
}

// Technical fouls, fouls by coaches and bench players, and bench disqualifications never count toward team fouls.
export function countsTowardTeamFouls(action: GameAction) {
  if (action.type !== 'foul' || isFoulCoachId(action.playerId)) return false
  return action.foulType === undefined || action.foulType === 'P' || action.foulType === 'U' || action.foulType === 'D'
}

// A bench disqualification is stored as BD so it does not count toward team fouls, but it is shown as D.
export function foulCode(foulType: FoulType) {
  return foulType === 'BD' ? 'D' : foulType
}

// Numbers each personal foul per player in order: the first is P1, the second P2, and so on.
export function personalFoulNumbers(actions: GameAction[]) {
  const counts = new Map<string, number>()
  const numbers = new Map<string, number>()
  for (const action of actions) {
    if (action.type !== 'foul' || action.foulType !== 'P' || action.playerId === null) continue
    const next = (counts.get(action.playerId) ?? 0) + 1
    counts.set(action.playerId, next)
    numbers.set(action.id, next)
  }
  return numbers
}

export function getPeriodTeamFouls(game: GameState) {
  const period = Math.max(1, game.period ?? 1)
  const group = foulPeriodGroup(period, game.youth ?? false)
  const counts: Record<string, number> = Object.create(null)
  for (const action of game.actions) {
    if (countsTowardTeamFouls(action) && foulPeriodGroup(action.period ?? period, game.youth ?? false) === group) {
      counts[action.teamId] = (counts[action.teamId] ?? 0) + 1
    }
  }
  return counts
}

export function getScore(game: GameState) {
  const pointsByTeam = new Map(game.teams.map((team) => [team.id, 0]))
  for (const action of game.actions) {
    if (action.type === 'score') {
      const points = pointsByTeam.get(action.teamId)
      if (points !== undefined) pointsByTeam.set(action.teamId, points + action.value)
    }
  }

  return game.teams.map((team) => ({
    ...team,
    points: pointsByTeam.get(team.id) ?? 0,
  }))
}

export function getTeamStats(game: GameState): TeamStats[] {
  const stats = game.teams.map((team) => ({
    teamId: team.id,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    legacyRebounds: 0,
    assists: 0,
    turnovers: 0,
    fouls: 0,
    blocks: 0,
    steals: 0,
    missedShots: 0,
  }))
  const statsByTeam = new Map(stats.map((item) => [item.teamId, item]))

  for (const action of game.actions) {
    const teamStats = statsByTeam.get(action.teamId)
    if (!teamStats) continue

    switch (action.type) {
      case 'offensive_rebound': teamStats.offensiveRebounds += 1; break
      case 'defensive_rebound': teamStats.defensiveRebounds += 1; break
      case 'rebound': teamStats.legacyRebounds += 1; break
      case 'assist': teamStats.assists += 1; break
      case 'turnover': teamStats.turnovers += 1; break
      case 'foul': if (countsTowardTeamFouls(action)) teamStats.fouls += 1; break
      case 'block': teamStats.blocks += 1; break
      case 'steal': teamStats.steals += 1; break
      case 'missed_shot': teamStats.missedShots += 1; break
    }
  }
  return stats
}

export function getRecentActions(game: GameState, limit = 8, unknownPlayerName = '—'): RecentAction[] {
  const playerNamesById = new Map(game.players.map((player) => [player.id, player.name]))
  const assistsByGroup = new Map<string, string>()
  for (const action of game.actions) {
    if (action.type === 'assist' && action.groupId) {
      assistsByGroup.set(
        action.groupId,
        (action.playerId !== null ? playerNamesById.get(action.playerId) : undefined) ?? unknownPlayerName,
      )
    }
  }

  const personalNumbers = personalFoulNumbers(game.actions)
  const scoredGroups = new Set(
    game.actions.filter((action) => action.type === 'score' && action.groupId).map((action) => action.groupId),
  )

  return [...game.actions]
    .reverse()
    .filter((action) => !(
      action.type === 'assist'
      && action.groupId
      && scoredGroups.has(action.groupId)
    ))
    .slice(0, limit)
    .map((action) => ({
      action,
      assistName: action.type === 'score' && action.groupId ? assistsByGroup.get(action.groupId) ?? '' : '',
      personalFoulNumber: personalNumbers.get(action.id),
    }))
}

export function getPlayerName(game: GameState, playerId: string, unknownPlayerName = '—') {
  return game.players.find((player) => player.id === playerId)?.name ?? unknownPlayerName
}

export function undoLastAction(actions: GameAction[]) {
  const lastAction = actions[actions.length - 1]
  if (!lastAction) return actions
  if (lastAction.groupId) return actions.filter((action) => action.groupId !== lastAction.groupId)
  return actions.slice(0, -1)
}

export function updateActionPlayer(actions: GameAction[], actionId: string, playerId: string) {
  return actions.map((action) => action.id === actionId ? { ...action, playerId } : action)
}

export function isReboundType(type: unknown): type is 'offensive_rebound' | 'defensive_rebound' {
  return type === 'offensive_rebound' || type === 'defensive_rebound'
}

// The rebound is a player id, or 'opponent' for a rebound by the other team (recorded without a player), or 'none'.
export function updateMissedShotPlay(
  actions: GameAction[],
  input: {
    actionId?: string
    teamId: string
    otherTeamId: string
    shooterId: string
    value: number
    rebound: string | null
    shotLocation?: ShotLocation
    period: number
    createdAt: number
    createId: () => string
  },
) {
  const existingShot = input.actionId
    ? actions.find((action) => action.id === input.actionId && action.type === 'missed_shot')
    : undefined
  const existingRebound = existingShot?.groupId
    ? actions.find((action) => action.groupId === existingShot.groupId && isReboundType(action.type))
    : undefined
  const rebound = input.rebound
  const hasRebound = rebound !== null && rebound !== 'none'
  const groupId = hasRebound ? existingShot?.groupId ?? input.createId() : undefined
  let updated = [...actions]
  if (existingShot) {
    updated = updated.map((action) => {
      if (action.id !== existingShot.id) return action
      const shot = { ...action, playerId: input.shooterId }
      delete shot.groupId
      delete shot.shotLocation
      return {
        ...shot,
        ...(input.shotLocation ? { shotLocation: input.shotLocation } : {}),
        ...(groupId ? { groupId } : {}),
      }
    })
  } else {
    updated.push({
      id: input.createId(),
      playerId: input.shooterId,
      teamId: input.teamId,
      type: 'missed_shot',
      value: input.value,
      createdAt: input.createdAt,
      ...(input.shotLocation ? { shotLocation: input.shotLocation } : {}),
      ...(groupId ? { groupId } : {}),
    })
  }
  if (!rebound || rebound === 'none') {
    return existingRebound ? updated.filter((action) => action.id !== existingRebound.id) : updated
  }
  // A rebound by the team that missed is offensive; by the other team it is defensive.
  const reboundTeamId = rebound === 'opponent' ? input.otherTeamId : input.teamId
  const reboundFields = {
    playerId: rebound === 'opponent' ? null : rebound,
    teamId: reboundTeamId,
    type: reboundTeamId === input.teamId ? 'offensive_rebound' as const : 'defensive_rebound' as const,
    value: 1,
    groupId: groupId!,
  }
  if (existingRebound) {
    return updated.map((action) => action.id === existingRebound.id ? { ...action, ...reboundFields } : action)
  }
  updated.push({ id: input.createId(), ...reboundFields, createdAt: input.createdAt, period: input.period })
  return updated
}

export function updateScoringPlay(
  actions: GameAction[],
  input: {
    actionId?: string
    teamId: string
    scorerId: string
    value: number
    assistPlayerId: string | null
    shotLocation?: ShotLocation
    period?: number
    createdAt: number
    createId: () => string
  },
) {
  const existingScore = input.actionId
    ? actions.find((action) => action.id === input.actionId && action.type === 'score')
    : undefined
  const existingAssist = existingScore?.groupId
    ? actions.find((action) => action.groupId === existingScore.groupId && action.type === 'assist')
    : undefined
  const groupId = input.assistPlayerId
    ? existingScore?.groupId ?? input.createId()
    : undefined
  let updated = [...actions]

  if (existingScore) {
    updated = updated.map((action) => {
      if (action.id !== existingScore.id) return action
      const score = { ...action }
      delete score.groupId
      delete score.shotLocation
      return {
        ...score,
        playerId: input.scorerId,
        value: input.value,
        ...(input.shotLocation ? { shotLocation: input.shotLocation } : {}),
        ...(groupId ? { groupId } : {}),
      }
    })
  } else {
    updated.push({
      id: input.createId(),
      playerId: input.scorerId,
      teamId: input.teamId,
      type: 'score',
      value: input.value,
      createdAt: input.createdAt,
      ...(input.period !== undefined ? { period: input.period } : {}),
      ...(input.shotLocation ? { shotLocation: input.shotLocation } : {}),
      ...(groupId ? { groupId } : {}),
    })
  }

  if (input.assistPlayerId) {
    if (existingAssist) {
      updated = updated.map((action) => action.id === existingAssist.id
        ? { ...action, playerId: input.assistPlayerId ?? action.playerId }
        : action)
    } else {
      updated.push({
        id: input.createId(),
        playerId: input.assistPlayerId,
        teamId: input.teamId,
        type: 'assist',
        value: 1,
        createdAt: input.createdAt,
        ...((existingScore ? existingScore.period : input.period) !== undefined
          ? { period: existingScore ? existingScore.period : input.period } : {}),
        groupId: groupId!,
      })
    }
  } else if (existingAssist) {
    updated = updated.filter((action) => action.id !== existingAssist.id)
  }

  return updated
}
