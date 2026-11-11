import type { AppLocale } from '../i18n/types'

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

export type Team = { id: string; name: string; color: string }
export type Player = {
  id: string
  name: string
  teamId: string
  jerseyNumber: string
  isOnCourt: boolean
}
export type ShotLocation =
  | { area: 'opponent'; x: number; y: number }
  | { area: 'own' }
export type GameAction = {
  id: string
  playerId: string
  teamId: string
  type: StatType
  value: number
  createdAt: number
  groupId?: string
  shotLocation?: ShotLocation
}
export type GameState = {
  teams: Team[]
  players: Player[]
  actions: GameAction[]
  gameStarted: boolean
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
export type RecentAction = { action: GameAction; assistName: string }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
      || typeof team.color !== 'string') {
      throw new Error('Opgeslagen teamgegevens zijn ongeldig.')
    }
    return { id: team.id, name: team.name, color: team.color }
  })
  if (teams.length !== 2 || new Set(teams.map((team) => team.id)).size !== 2) {
    throw new Error('Een wedstrijd moet precies twee verschillende teams hebben.')
  }

  const rawPlayers = value.players
  const rawActions = value.actions
  if (isUnusedLegacyDemoRoster(rawPlayers, rawActions)) {
    return { ...createInitialGameState(locale), teams, gameStarted: value.gameStarted }
  }

  const courtCounts = new Map<string, number>()
  const players = rawPlayers.map((player): Player => {
    if (!isRecord(player)
      || typeof player.id !== 'string'
      || typeof player.name !== 'string'
      || typeof player.teamId !== 'string'
      || !teams.some((team) => team.id === player.teamId)) {
      throw new Error('Opgeslagen spelersgegevens zijn ongeldig.')
    }

    const activeCount = courtCounts.get(player.teamId) ?? 0
    const requestedOnCourt = typeof player.isOnCourt === 'boolean' ? player.isOnCourt : activeCount < 5
    const isOnCourt = requestedOnCourt && activeCount < 5
    if (isOnCourt) courtCounts.set(player.teamId, activeCount + 1)

    return {
      id: player.id,
      name: player.name,
      teamId: player.teamId,
      jerseyNumber: typeof player.jerseyNumber === 'string' ? player.jerseyNumber : '',
      isOnCourt,
    }
  })

  const actions = rawActions.map((action): GameAction => {
    if (!isRecord(action)
      || typeof action.id !== 'string'
      || typeof action.playerId !== 'string'
      || typeof action.teamId !== 'string'
      || !teams.some((team) => team.id === action.teamId)
      || !isStatType(action.type)
      || typeof action.value !== 'number'
      || !Number.isFinite(action.value)
      || typeof action.createdAt !== 'number'
      || !Number.isFinite(action.createdAt)
      || (action.groupId !== undefined && typeof action.groupId !== 'string')
      || (action.shotLocation !== undefined && !isShotLocation(action.shotLocation))) {
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
    }
  })

  return { teams, players, actions, gameStarted: value.gameStarted }
}

export function canStartGame(game: GameState) {
  return game.teams.every((team) => {
    const teamPlayers = game.players.filter((player) => player.teamId === team.id)
    return teamPlayers.filter((player) => player.isOnCourt).length === 5
      && teamPlayers.every((player) => player.jerseyNumber !== '')
  })
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
      case 'foul': teamStats.fouls += 1; break
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
        playerNamesById.get(action.playerId) ?? unknownPlayerName,
      )
    }
  }

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

export function updateScoringPlay(
  actions: GameAction[],
  input: {
    actionId?: string
    teamId: string
    scorerId: string
    value: number
    assistPlayerId: string | null
    shotLocation: ShotLocation
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
      return {
        ...score,
        playerId: input.scorerId,
        value: input.value,
        shotLocation: input.shotLocation,
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
      shotLocation: input.shotLocation,
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
        groupId: groupId!,
      })
    }
  } else if (existingAssist) {
    updated = updated.filter((action) => action.id !== existingAssist.id)
  }

  return updated
}
