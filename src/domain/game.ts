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
export type GameAction = {
  id: string
  playerId: string
  teamId: string
  type: StatType
  value: number
  createdAt: number
  groupId?: string
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

export function createInitialGameState(): GameState {
  const teams: Team[] = [
    { id: 'home', name: 'Thuis', color: '#f26a36' },
    { id: 'away', name: 'Uit', color: '#5d72d9' },
  ]
  const players = teams.flatMap((team) =>
    Array.from({ length: 5 }, (_, index): Player => ({
      id: `${team.id}-${index + 1}`,
      name: `Speler ${index + 1}`,
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

function isUnusedLegacyDemoRoster(players: unknown[], actions: unknown[]) {
  return actions.length === 0
    && players.length === 10
    && players.every((player, index) => {
      if (!isRecord(player)) return false
      return player.id === `${index < 5 ? 'h' : 'a'}${index % 5 + 1}`
        && player.name === `Speler ${(index % 5) + 1}`
    })
}

export function parseGameState(value: unknown): GameState {
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
    return { ...createInitialGameState(), teams, gameStarted: value.gameStarted }
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
      || (action.groupId !== undefined && typeof action.groupId !== 'string')) {
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
  return game.teams.map((team) => ({
    ...team,
    points: game.actions
      .filter((action) => action.teamId === team.id && action.type === 'score')
      .reduce((total, action) => total + action.value, 0),
  }))
}

export function getTeamStats(game: GameState): TeamStats[] {
  return game.teams.map((team) => {
    const actions = game.actions.filter((action) => action.teamId === team.id)
    return {
      teamId: team.id,
      offensiveRebounds: actions.filter((action) => action.type === 'offensive_rebound').length,
      defensiveRebounds: actions.filter((action) => action.type === 'defensive_rebound').length,
      legacyRebounds: actions.filter((action) => action.type === 'rebound').length,
      assists: actions.filter((action) => action.type === 'assist').length,
      turnovers: actions.filter((action) => action.type === 'turnover').length,
      fouls: actions.filter((action) => action.type === 'foul').length,
      blocks: actions.filter((action) => action.type === 'block').length,
      steals: actions.filter((action) => action.type === 'steal').length,
      missedShots: actions.filter((action) => action.type === 'missed_shot').length,
    }
  })
}

export function getRecentActions(game: GameState, limit = 8): RecentAction[] {
  const assistsByGroup = new Map<string, string>()
  for (const action of game.actions) {
    if (action.type === 'assist' && action.groupId) {
      assistsByGroup.set(
        action.groupId,
        game.players.find((player) => player.id === action.playerId)?.name ?? 'Onbekende speler',
      )
    }
  }

  return [...game.actions]
    .reverse()
    .filter((action) => !(
      action.type === 'assist'
      && action.groupId
      && game.actions.some((score) => score.groupId === action.groupId && score.type === 'score')
    ))
    .slice(0, limit)
    .map((action) => ({
      action,
      assistName: action.type === 'score' && action.groupId ? assistsByGroup.get(action.groupId) ?? '' : '',
    }))
}

export function getPlayerName(game: GameState, playerId: string) {
  return game.players.find((player) => player.id === playerId)?.name ?? 'Onbekende speler'
}

export function getActionLabel(action: Pick<GameAction, 'type' | 'value'>) {
  if (action.type === 'score') return `+${action.value} punt${action.value > 1 ? 'en' : ''}`
  if (action.type === 'missed_shot') return `Gemist (${action.value} punt${action.value > 1 ? 'en' : ''})`
  if (action.type === 'offensive_rebound') return 'Aanvallende rebound'
  if (action.type === 'defensive_rebound') return 'Verdedigende rebound'
  if (action.type === 'rebound') return 'Rebound'
  if (action.type === 'assist') return 'Assist'
  if (action.type === 'turnover') return 'Turnover'
  if (action.type === 'foul') return 'Fout'
  if (action.type === 'block') return 'Block'
  return 'Steal'
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
      return { ...score, playerId: input.scorerId, value: input.value, ...(groupId ? { groupId } : {}) }
    })
  } else {
    updated.push({
      id: input.createId(),
      playerId: input.scorerId,
      teamId: input.teamId,
      type: 'score',
      value: input.value,
      createdAt: input.createdAt,
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
