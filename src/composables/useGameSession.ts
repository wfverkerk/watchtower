import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  canStartGame as isReadyToStart,
  createInitialGameState,
  getPlayerName,
  getPlayerFouls,
  getPeriodTeamFouls,
  getRecentActions,
  getScore,
  getTeamStats,
  parseGameState,
  startNextPeriod,
  undoLastAction as undoActions,
  updateActionPlayer,
  updateScoringPlay,
  type GameAction,
  type FoulType,
  type GameMatchInfo,
  type GameState,
  type Player,
  type ShotLocation,
  type StatType,
  type TurnoverType,
} from '../domain/game'
import { clockRemaining, formatClock, isYouthTeam, newPeriodClock, pauseClock, reconcileClock, startClock } from '../domain/gameClock'
import { lineupChanges } from '../domain/matchTimeline'
import { loadGameState, saveGameState } from '../services/gameStorage'
import { applyGameRoster, createGameRosterDraft } from '../services/gameRoster'
import {
  createDefaultTeamProfiles,
  clearTeamSetupDraft,
  hasSavedTeamProfiles,
  loadTeamProfileSelection,
  loadTeamProfiles,
  saveTeamProfileSelection,
  saveTeamProfiles,
  type TeamProfile,
} from '../services/teamProfiles'
import {
  appendMatchEvents,
  discardMatchEventsExcept,
  loadMatchEvents,
  loadMatchLink,
  removeMatchEvents,
  saveMatchLink,
  type MatchEvent,
  type MatchEventType,
  type MatchLink,
} from '../services/matchEventLog'
import { createSharedMatch as createSharedMatchRecord, joinSharedMatch as joinSharedMatchRecord, uploadMatchEvents } from '../services/sharedMatch'
import { ensureAnonymousUser, isSupabaseConfigured } from '../services/supabaseClient'
import { loadZoebasTeams, type ZoebasTeam } from '../services/zoebasTeams'
import type { ZoebasMatch } from '../services/zoebasMatches'
import { isAppLocale, useLocale } from '../i18n/useLocale'

type PendingAction = { type: StatType; value: number }

export function useGameSession() {
  const { t, locale, displayPlayerName } = useLocale()
  const currentLocale = computed(() => isAppLocale(locale.value) ? locale.value : 'nl')
  const game = reactive<GameState>(createInitialGameState(currentLocale.value))
  const selectedTeamId = ref(game.teams[0].id)
  const pendingAction = ref<PendingAction | null>(null)
  const pendingScorerId = ref('')
  const pendingAssistId = ref<string | 'none' | null>(null)
  const pendingShotLocation = ref<ShotLocation | null>(null)
  const pendingFoulType = ref<FoulType | null>(null)
  const pendingTurnoverType = ref<TurnoverType>('turnover')
  const editingActionId = ref<string | null>(null)
  const scoreNotification = ref<{ id: number; teamId: string; value: 1 | 2 | 3 } | null>(null)
  let scoreNotificationId = 0
  const lineupEditorOpen = ref(false)
  const startingPeriod = ref(false)
  const draftCourtPlayerIds = ref<string[]>([])
  const teamProfiles = ref(createDefaultTeamProfiles())
  const selectedTeamProfileIds = ref<[string, string]>(['zoebas-x12-1', 'opponent-default'])
  const teamSetupOpen = ref(false)
  const teamSetupInitializing = ref(true)
  const teamSetupComplete = ref(false)
  const teamCatalog = ref<ZoebasTeam[]>([])
  const teamCatalogLoading = ref(true)
  const teamCatalogError = ref('')
  const lineupErrorKey = ref('')
  const storageErrorKey = ref('')
  const matchLink = ref<MatchLink | null>(null)
  const matchSyncStatus = ref<'local' | 'offline' | 'syncing' | 'synced' | 'error'>('local')
  const matchSyncError = ref('')
  const matchSyncConfigured = isSupabaseConfigured()
  let initializing = true
  let previousActions: GameAction[] = []
  let syncScheduled = false
  let syncInProgress = false
  let syncRequested = false
  let syncTimer: number | undefined
  let clockTimer: number | undefined
  const clockNow = ref(Date.now())

  const selectedTeam = computed(() =>
    game.teams.find((team) => team.id === selectedTeamId.value) ?? game.teams[0],
  )
  const allTeamPeople = computed(() => game.players.filter((player) => player.teamId === selectedTeamId.value))
  const teamPeople = computed(() => allTeamPeople.value.filter((player) => player.isParticipating !== false))
  const teamPlayers = computed(() => teamPeople.value.filter((player) => !player.isCoach))
  const onCourtPlayers = computed(() => teamPlayers.value.filter((player) => player.isOnCourt))
  const pickerPlayers = computed(() => {
    if (pendingAction.value?.type === 'foul') return editingActionId.value ? allTeamPeople.value : teamPeople.value
    return editingActionId.value ? allTeamPeople.value.filter((player) => !player.isCoach) : onCourtPlayers.value
  })
  const canStart = computed(() => teamSetupComplete.value && (game.period === 0
    ? game.players.filter((player) => player.teamId === game.teams[0].id && !player.isCoach && player.isParticipating !== false).length >= 2
    : isReadyToStart(game)))
  const canCancelTeamSetup = computed(() => game.period !== undefined || game.gameStarted || game.actions.length > 0)
  const canStartNewMatch = computed(() => !game.gameStarted && (game.period !== undefined || game.actions.length > 0))
  const scores = computed(() => getScore(game))
  const teamStats = computed(() => getTeamStats(game))
  const playerFouls = computed(() => getPlayerFouls(game.actions))
  const periodTeamFouls = computed(() => getPeriodTeamFouls(game))
  const clockDisplay = computed(() => formatClock(game.clock ? clockRemaining(game.clock, clockNow.value) : 0))
  const recentActions = computed(() => getRecentActions(game, game.actions.length, t('app.unknownPlayer')))
  const lineupError = computed(() => lineupErrorKey.value ? t(lineupErrorKey.value) : '')
  const storageError = computed(() => storageErrorKey.value ? t(storageErrorKey.value) : '')
  const rosterEditProfile = computed(() => {
    const home = game.teams[0]
    const homePlayers = game.players.filter((player) => player.teamId === home.id && !player.isCoach)
    const matchesGame = (profile: TeamProfile) =>
      profile.id !== selectedTeamProfileIds.value[1]
      && profile.name.trim().toLocaleLowerCase() === home.name.trim().toLocaleLowerCase()
      && profile.players.some((player) =>
        homePlayers.some((item) => item.id === player.id || item.id === `${home.id}-${player.id}`),
      )
    const selected = teamProfiles.value.find((item) => item.id === selectedTeamProfileIds.value[0])
    const profile = selected && matchesGame(selected)
      ? selected
      : teamProfiles.value.find(matchesGame) ?? {
          id: crypto.randomUUID(),
          name: home.name,
          players: [],
          coaches: [],
        }
    return createGameRosterDraft(game, profile)
  })

  function makeMatchEvent(action: GameAction, type: MatchEventType, link: MatchLink): MatchEvent {
    return {
      id: crypto.randomUUID(),
      matchId: link.matchId,
      trackerId: link.trackerId,
      trackerName: link.displayName,
      actionId: action.id,
      type,
      action: JSON.parse(JSON.stringify(action)) as GameAction,
      occurredAt: Date.now(),
      synced: false,
    }
  }

  function scheduleMatchSync() {
    if (syncScheduled) return
    if (syncInProgress) {
      syncRequested = true
      return
    }
    syncScheduled = true
    syncTimer = window.setTimeout(() => {
      syncScheduled = false
      syncTimer = undefined
      void syncPendingMatchEvents()
    }, 250)
  }

  async function syncPendingMatchEvents() {
    if (syncInProgress) {
      syncRequested = true
      return
    }
    const link = matchLink.value
    if (!link || !matchSyncConfigured) return
    if (!navigator.onLine) {
      matchSyncStatus.value = 'offline'
      return
    }

    syncInProgress = true
    try {
      const currentTrackerId = await ensureAnonymousUser()
      if (currentTrackerId !== link.trackerId) {
        throw new Error('This device is signed in as a different tracker. Rejoin the match to continue syncing.')
      }

      const queuedEvents = loadMatchEvents()
      const completedEvents = queuedEvents.filter((event) =>
        event.matchId === link.matchId && event.trackerId === link.trackerId && event.synced,
      )
      const pendingEvents = queuedEvents.filter((event) =>
        event.matchId === link.matchId && event.trackerId === link.trackerId && !event.synced,
      )
      if (pendingEvents.length === 0) {
        if (completedEvents.length) removeMatchEvents(completedEvents.map((event) => event.id))
        matchSyncStatus.value = 'synced'
        matchSyncError.value = ''
        return
      }

      matchSyncStatus.value = 'syncing'
      matchSyncError.value = ''
      await uploadMatchEvents(pendingEvents)
      removeMatchEvents([
        ...completedEvents.map((event) => event.id),
        ...pendingEvents.map((event) => event.id),
      ])
      matchSyncStatus.value = 'synced'
    } catch (error) {
      console.error('Failed to sync match events.', error)
      matchSyncError.value = error instanceof Error ? error.message : String(error)
      matchSyncStatus.value = 'error'
    } finally {
      syncInProgress = false
      const shouldRunAgain = syncRequested
      syncRequested = false
      if (shouldRunAgain && matchSyncStatus.value !== 'error') scheduleMatchSync()
    }
  }

  async function createSharedMatch(displayName: string) {
    if (!matchSyncConfigured) {
      matchSyncError.value = t('sync.notConfigured')
      return false
    }
    try {
      const gameData: GameState = {
        teams: game.teams.map((team) => ({ ...team })),
        players: game.players.map((player) => ({ ...player })),
        actions: game.actions.map((action) => ({ ...action })),
        gameStarted: game.gameStarted,
        ...(game.matchInfo ? { matchInfo: { ...game.matchInfo } } : {}),
        ...(game.period !== undefined ? { period: game.period } : {}),
        ...(game.youth !== undefined ? { youth: game.youth } : {}),
        ...(game.clock ? { clock: { ...game.clock } } : {}),
        ...(game.timeline ? { timeline: game.timeline.map((event) => ({ ...event })) } : {}),
      }
      const created = await createSharedMatchRecord(gameData, displayName)
      saveMatchLink(created.link)
      discardMatchEventsExcept(created.link.matchId)
      matchLink.value = created.link
      matchSyncError.value = ''
      const initialEvents = game.actions.map((action) => makeMatchEvent(action, 'action_added', created.link))
      appendMatchEvents(initialEvents)
      matchSyncStatus.value = initialEvents.length ? 'syncing' : 'synced'
      scheduleMatchSync()
      return true
    } catch (error) {
      console.error('Failed to create a shared match.', error)
      matchSyncError.value = error instanceof Error ? error.message : String(error)
      matchSyncStatus.value = 'error'
      return false
    }
  }

  async function joinSharedMatch(joinCode: string, displayName: string) {
    if (!matchSyncConfigured) {
      matchSyncError.value = t('sync.notConfigured')
      return false
    }
    try {
      const joined = await joinSharedMatchRecord(joinCode, displayName)
      const sharedGame = parseGameState(joined.gameData, currentLocale.value)
      initializing = true
      game.teams = sharedGame.teams
      game.players = sharedGame.players
      game.actions = sharedGame.actions
      game.gameStarted = sharedGame.gameStarted
      game.period = sharedGame.period
      game.matchInfo = sharedGame.matchInfo
      game.youth = sharedGame.youth
      game.clock = sharedGame.clock
      game.timeline = sharedGame.timeline ?? []
      initializeClock()
      saveMatchLink(joined.link)
      discardMatchEventsExcept(joined.link.matchId)
      matchLink.value = joined.link
      selectedTeamId.value = 'home'
      previousActions = JSON.parse(JSON.stringify(game.actions)) as GameAction[]
      initializing = false
      matchSyncError.value = ''
      matchSyncStatus.value = 'synced'
      return true
    } catch (error) {
      initializing = false
      console.error('Failed to join a shared match.', error)
      matchSyncError.value = error instanceof Error ? error.message : String(error)
      matchSyncStatus.value = 'error'
      return false
    }
  }

  function playerName(playerId: string) {
    if (playerId.startsWith('coach-') && !game.players.some((player) => player.id === playerId)) {
      return t('controls.coach')
    }
    return displayPlayerName(getPlayerName(game, playerId, t('app.unknownPlayer')))
  }

  function cancelPendingAction() {
    pendingAction.value = null
    pendingScorerId.value = ''
    pendingAssistId.value = null
    pendingShotLocation.value = null
    pendingFoulType.value = null
    pendingTurnoverType.value = 'turnover'
    editingActionId.value = null
    selectedTeamId.value = game.teams[0].id
  }

  function addAction(type: StatType, value = 1) {
    if (!game.gameStarted) return
    selectedTeamId.value = game.teams[0].id
    editingActionId.value = null
    pendingAction.value = { type, value }
    pendingScorerId.value = ''
    pendingAssistId.value = type === 'score' && value > 1 ? 'none' : null
    pendingShotLocation.value = null
    pendingFoulType.value = type === 'foul' ? 'P' : null
    pendingTurnoverType.value = 'turnover'
  }

  function notifyScore(teamId: string, value: 1 | 2 | 3) {
    scoreNotification.value = { id: ++scoreNotificationId, teamId, value }
  }

  function addOpponentScore(value: 1 | 2 | 3) {
    if (!game.gameStarted) return
    game.actions.push({
      id: crypto.randomUUID(),
      playerId: null,
      teamId: game.teams[1].id,
      type: 'score',
      value,
      createdAt: Date.now(),
      period: Math.max(1, game.period ?? 1),
    })
    notifyScore(game.teams[1].id, value)
  }

  function removeOpponentScore(action: GameAction) {
    if (action.type !== 'score' || action.teamId !== game.teams[1].id || action.playerId !== null) return
    game.actions = game.actions.filter((item) => item.id !== action.id)
  }

  function selectPlayer(playerId: string) {
    const action = pendingAction.value
    if (!action || !game.gameStarted) return
    if (action.type === 'foul' || action.type === 'turnover') {
      pendingScorerId.value = playerId
      return
    }
    if (action.type === 'score') {
      selectScorer(playerId)
      return
    }
    if (action.type === 'missed_shot' && action.value > 1) {
      pendingScorerId.value = playerId
      return
    }

    if (editingActionId.value) {
      game.actions = updateActionPlayer(game.actions, editingActionId.value, playerId)
    } else {
      game.actions.push({
        id: crypto.randomUUID(),
        playerId,
        teamId: selectedTeamId.value,
        type: action.type,
        value: action.value,
        createdAt: Date.now(),
      })
    }
    cancelPendingAction()
  }

  function finishFoulAction() {
    const action = pendingAction.value
    if (action?.type !== 'foul' || !pendingScorerId.value || !pendingFoulType.value) return

    if (editingActionId.value) {
      game.actions = game.actions.map((item) => item.id === editingActionId.value
        ? { ...item, playerId: pendingScorerId.value, foulType: pendingFoulType.value ?? undefined }
        : item)
    } else {
      game.actions.push({
        id: crypto.randomUUID(),
        playerId: pendingScorerId.value,
        teamId: selectedTeamId.value,
        type: action.type,
        value: action.value,
        createdAt: Date.now(),
        foulType: pendingFoulType.value,
        period: Math.max(1, game.period ?? 1),
      })
    }
    cancelPendingAction()
  }

  function finishTurnoverAction() {
    if (pendingAction.value?.type !== 'turnover' || !pendingScorerId.value) return
    if (editingActionId.value) {
      game.actions = game.actions.map((item) => item.id === editingActionId.value
        ? { ...item, playerId: pendingScorerId.value, turnoverType: pendingTurnoverType.value }
        : item)
    } else {
      game.actions.push({
        id: crypto.randomUUID(),
        playerId: pendingScorerId.value,
        teamId: selectedTeamId.value,
        type: 'turnover',
        value: pendingAction.value.value,
        createdAt: Date.now(),
        turnoverType: pendingTurnoverType.value,
      })
    }
    cancelPendingAction()
  }

  function selectScorer(playerId: string) {
    const action = pendingAction.value
    if (!action || action.type !== 'score') return
    if (action.value === 1) {
      if (editingActionId.value) {
        game.actions = updateActionPlayer(game.actions, editingActionId.value, playerId)
      } else {
        game.actions.push({
          id: crypto.randomUUID(),
          playerId,
          teamId: selectedTeamId.value,
          type: 'score',
          value: action.value,
          createdAt: Date.now(),
        })
        notifyScore(selectedTeamId.value, 1)
      }
      cancelPendingAction()
      return
    }
    pendingScorerId.value = playerId
    if (pendingAssistId.value === playerId) pendingAssistId.value = null
  }

  function finishShotAction() {
    const action = pendingAction.value
    if (
      !action
      || (action.type !== 'score' && action.type !== 'missed_shot')
      || action.value <= 1
      || !pendingScorerId.value
      || (action.type === 'score' && pendingAssistId.value === null)
    ) return

    const shotLocation = pendingShotLocation.value ?? undefined
    if (action.type === 'score') {
      game.actions = updateScoringPlay(game.actions, {
        actionId: editingActionId.value ?? undefined,
        teamId: selectedTeamId.value,
        scorerId: pendingScorerId.value,
        value: action.value,
        assistPlayerId: pendingAssistId.value === 'none' ? null : pendingAssistId.value,
        ...(shotLocation ? { shotLocation } : {}),
        createdAt: Date.now(),
        createId: () => crypto.randomUUID(),
      })
      if (!editingActionId.value && (action.value === 2 || action.value === 3)) {
        notifyScore(selectedTeamId.value, action.value)
      }
    } else if (editingActionId.value) {
      game.actions = game.actions.map((item) => {
        if (item.id !== editingActionId.value) return item
        const updated = { ...item, playerId: pendingScorerId.value }
        delete updated.shotLocation
        return { ...updated, ...(shotLocation ? { shotLocation } : {}) }
      })
    } else {
      game.actions.push({
        id: crypto.randomUUID(),
        playerId: pendingScorerId.value,
        teamId: selectedTeamId.value,
        type: 'missed_shot',
        value: action.value,
        createdAt: Date.now(),
        shotLocation,
      })
    }
    cancelPendingAction()
  }

  function editAction(action: GameAction) {
    if (action.playerId === null) return
    selectedTeamId.value = action.teamId
    pendingAction.value = { type: action.type, value: action.value }
    editingActionId.value = action.id
    pendingScorerId.value = action.playerId
    const assist = action.groupId
      ? game.actions.find((item) => item.groupId === action.groupId && item.type === 'assist')
      : undefined
    pendingAssistId.value = action.type === 'score' && action.value > 1
      ? assist?.playerId ?? 'none'
      : null
    pendingShotLocation.value = (action.type === 'score' || action.type === 'missed_shot') && action.value > 1
      ? action.shotLocation ?? null
      : null
    pendingFoulType.value = action.type === 'foul' ? action.foulType ?? null : null
    pendingTurnoverType.value = action.type === 'turnover' ? action.turnoverType ?? 'turnover' : 'turnover'
  }

  function undoLastAction() {
    game.actions = undoActions(game.actions)
  }

  function applyTeamSetup(
    profiles: TeamProfile[],
    profileIds: [string, string],
    selectedMatch: ZoebasMatch | null = null,
    manualOpponentName = '',
  ) {
    const homeProfile = profiles.find((profile) => profile.id === profileIds[0])
    const awayProfile = profiles.find((profile) => profile.id === profileIds[1])
    if (!homeProfile?.catalogTeamId || !awayProfile || profileIds[0] === profileIds[1]) {
      storageErrorKey.value = 'errors.invalidTeamSetup'
      return false
    }

    const matchHomeName = selectedMatch?.homeTeamName.toLocaleLowerCase() ?? ''
    const selectedTeamName = homeProfile.name.toLocaleLowerCase()
    const matchOwnTeamIsHome = !selectedMatch
      || matchHomeName.includes(selectedTeamName)
      || selectedTeamName.includes(matchHomeName)
    const opponentName = selectedMatch
      ? matchOwnTeamIsHome ? selectedMatch.awayTeamName : selectedMatch.homeTeamName
      : manualOpponentName.trim() || awayProfile.name.trim()
    const teams = [
      { id: 'home', name: homeProfile.name.trim(), color: '#f26a36' },
      { id: 'away', name: opponentName, color: '#5d72d9' },
    ]
    const players = [homeProfile, awayProfile].flatMap<Player>((profile, index) => [
      ...profile.players.filter((player) => player.isParticipating).map((player) => ({
        id: `${teams[index].id}-${player.id}`,
        name: player.name.trim(),
        teamId: teams[index].id,
        jerseyNumber: player.jerseyNumber,
        isOnCourt: index === 1,
      })),
      ...(profile.coaches ?? []).filter((coach) => coach.isParticipating).map((coach) => ({
        id: `${teams[index].id}-coach-${coach.id}`,
        name: coach.name.trim(),
        teamId: teams[index].id,
        jerseyNumber: '',
        isOnCourt: false,
        isCoach: true,
        coachRole: coach.role,
      })),
    ])
    const matchInfo: GameMatchInfo | undefined = selectedMatch
      ? {
          id: selectedMatch.id,
          date: selectedMatch.date,
          startTime: selectedMatch.startTime,
          venue: selectedMatch.venue,
        }
      : undefined
    const nextGame: GameState = {
      teams,
      players,
      actions: [],
      timeline: [],
      gameStarted: false,
      period: 0,
      youth: isYouthTeam(homeProfile.catalogTeamId) || isYouthTeam(homeProfile.name),
      ...(matchInfo ? { matchInfo } : {}),
    }
    const homePlayers = players.filter((player) => player.teamId === 'home' && !player.isCoach)
    if (homePlayers.length < 2
      || homePlayers.some((player) => !player.name || !/^\d{1,2}$/.test(player.jerseyNumber))
      || new Set(homePlayers.map((player) => Number(player.jerseyNumber))).size !== homePlayers.length
      || !opponentName) {
      storageErrorKey.value = 'errors.invalidTeamSetup'
      return false
    }

    try {
      saveTeamProfiles(profiles)
      saveTeamProfileSelection(profileIds)
      saveMatchLink(null)
      clearTeamSetupDraft()
      if (storageErrorKey.value === 'errors.loadTeams' || storageErrorKey.value === 'errors.saveTeams' || storageErrorKey.value === 'errors.invalidTeamSetup') {
        storageErrorKey.value = ''
      }
    } catch (error) {
      console.error('Failed to save team setup.', error)
      storageErrorKey.value = 'errors.saveTeams'
      return false
    }

    teamProfiles.value = profiles.map((profile) => ({
      ...profile,
      players: profile.players.map((player) => ({ ...player })),
    }))
    selectedTeamProfileIds.value = [...profileIds]
    teamSetupComplete.value = true
    teamSetupOpen.value = false
    matchLink.value = null
    matchSyncStatus.value = 'local'
    matchSyncError.value = ''
    Object.assign(game, nextGame, { matchInfo, clock: undefined })
    selectedTeamId.value = 'home'
    beginPeriod()
    return true
  }

  function updateSelectedProfilesFromGame() {
    const profiles = teamProfiles.value.map((profile) => ({
      ...profile,
      players: profile.players.map((player) => ({ ...player })),
    }))
    for (const [index, teamId] of ['home', 'away'].entries()) {
      const profile = profiles.find((item) => item.id === selectedTeamProfileIds.value[index])
      const team = game.teams.find((item) => item.id === teamId)
      if (!profile || !team) continue
      profile.name = team.name.trim()
      for (const player of profile.players) {
        player.isParticipating = false
        player.isOnCourt = false
      }
      for (const player of game.players.filter((item) => item.teamId === teamId && !item.isCoach)) {
        const profilePlayer = profile.players.find((item) => item.id === player.id)
          ?? profile.players.find((item) => `${teamId}-${item.id}` === player.id)
        const profilePlayerId = profilePlayer?.id ?? player.id
        const updatedPlayer: TeamProfile['players'][number] = {
          id: profilePlayerId,
          name: player.name.trim(),
          jerseyNumber: player.jerseyNumber,
          ...(profilePlayer?.catalogName ? { catalogName: profilePlayer.catalogName } : {}),
          isParticipating: player.isParticipating !== false,
          isOnCourt: player.isOnCourt,
        }
        if (profilePlayer) Object.assign(profilePlayer, updatedPlayer)
        else profile.players.push(updatedPlayer)
      }
    }
    try {
      saveTeamProfiles(profiles)
      teamProfiles.value = profiles
      if (storageErrorKey.value === 'errors.loadTeams' || storageErrorKey.value === 'errors.saveTeams') {
        storageErrorKey.value = ''
      }
      return true
    } catch (error) {
      console.error('Failed to save team profiles.', error)
      storageErrorKey.value = 'errors.saveTeams'
      return false
    }
  }

  function saveGameRoster(profile: TeamProfile) {
    const nextPlayers = applyGameRoster(game, profile)
    const homeId = game.teams[0].id
    const onCourt = nextPlayers.filter((player) => player.teamId === homeId && !player.isCoach && player.isOnCourt)
    if ((game.period ?? 0) > 0 && onCourt.length < 2) {
      storageErrorKey.value = 'errors.minOnCourt'
      return false
    }
    const profiles = teamProfiles.value.some((item) => item.id === profile.id)
      ? teamProfiles.value.map((item) => item.id === profile.id ? profile : item)
      : [...teamProfiles.value, profile]
    const profileIds: [string, string] = [profile.id, selectedTeamProfileIds.value[1]]
    try {
      saveTeamProfiles(profiles)
      if (profile.id !== selectedTeamProfileIds.value[0]) saveTeamProfileSelection(profileIds)
    } catch (error) {
      console.error('Failed to save team roster.', error)
      storageErrorKey.value = 'errors.saveTeams'
      return false
    }
    selectedTeamId.value = homeId
    if ((game.period ?? 0) > 0) recordLineupChanges(onCourt.map((player) => player.id), Date.now())
    game.players = nextPlayers
    teamProfiles.value = profiles
    selectedTeamProfileIds.value = profileIds
    storageErrorKey.value = ''
    return true
  }

  function openTeamSetup() {
    if (!game.gameStarted) teamSetupOpen.value = true
  }

  function cancelTeamSetup() {
    if (canCancelTeamSetup.value) teamSetupOpen.value = false
  }

  function toggleGame() {
    if (!game.gameStarted) {
      if (!canStart.value) return
      if (game.period === 0) {
        beginPeriod()
        return
      }
      if (!updateSelectedProfilesFromGame()) return
      selectedTeamId.value = 'home'
    }
    if (game.gameStarted && game.clock) {
      updateClock()
      game.clock = pauseClock(game.clock, Date.now())
    }
    game.gameStarted = !game.gameStarted
  }

  function openLineupEditor() {
    selectedTeamId.value = game.teams[0].id
    startingPeriod.value = false
    lineupErrorKey.value = ''
    draftCourtPlayerIds.value = onCourtPlayers.value.map((player) => player.id)
    lineupEditorOpen.value = true
  }

  function beginPeriod() {
    updateClock()
    selectedTeamId.value = game.teams[0].id
    startingPeriod.value = true
    lineupErrorKey.value = ''
    draftCourtPlayerIds.value = onCourtPlayers.value.map((player) => player.id)
    lineupEditorOpen.value = true
  }

  function toggleDraftCourtPlayer(playerId: string) {
    lineupErrorKey.value = ''
    if (draftCourtPlayerIds.value.includes(playerId)) {
      draftCourtPlayerIds.value = draftCourtPlayerIds.value.filter((id) => id !== playerId)
    } else if (draftCourtPlayerIds.value.length < 5) {
      draftCourtPlayerIds.value = [...draftCourtPlayerIds.value, playerId]
    }
  }

  function recordLineupChanges(selectedIds: string[], createdAt: number) {
    const changes = lineupChanges(teamPlayers.value, selectedIds)
    if (!changes.out.length && !changes.in.length) return
    const timeline = game.timeline ??= []
    timeline.push({ id: crypto.randomUUID(), type: 'substitution', period: Math.max(1, game.period ?? 1), createdAt, ...changes })
  }

  function recordPeriodEvent(type: 'period_start' | 'period_end', period: number, createdAt: number) {
    const timeline = game.timeline ??= []
    if (timeline.some((event) => event.type === type && event.period === period)) return
    timeline.push({ id: crypto.randomUUID(), type, period, createdAt })
  }

  function saveLineup() {
    if (draftCourtPlayerIds.value.length < 2 || draftCourtPlayerIds.value.length > 5) return
    if (startingPeriod.value) {
      const previousPeriod = game.period ?? 1
      const previousPlayers = teamPlayers.value.map((player) => ({ ...player }))
      if (!startNextPeriod(game, draftCourtPlayerIds.value)) {
        lineupErrorKey.value = 'errors.invalidPeriodLineup'
        return
      }
      const now = Date.now()
      if (previousPeriod > 0) {
        recordPeriodEvent('period_end', previousPeriod, now)
        const changes = lineupChanges(previousPlayers, draftCourtPlayerIds.value)
        if (changes.out.length || changes.in.length) {
          const timeline = game.timeline ??= []
          timeline.push({ id: crypto.randomUUID(), type: 'substitution', period: game.period ?? 1, createdAt: now, ...changes })
        }
      }
      recordPeriodEvent('period_start', game.period ?? 1, now)
      game.clock = newPeriodClock(game.period ?? 1, game.youth ?? false)
      clockNow.value = Date.now()
      startingPeriod.value = false
    } else {
      if ((game.period ?? 0) > 0) recordLineupChanges(draftCourtPlayerIds.value, Date.now())
      for (const player of teamPlayers.value) {
        player.isOnCourt = draftCourtPlayerIds.value.includes(player.id)
      }
    }
    if (pendingScorerId.value && !draftCourtPlayerIds.value.includes(pendingScorerId.value)) {
      cancelPendingAction()
    }
    lineupEditorOpen.value = false
  }

  function cancelLineupEdit() {
    lineupEditorOpen.value = false
    startingPeriod.value = false
    draftCourtPlayerIds.value = []
  }

  function initializeClock() {
    const period = Math.max(1, game.period ?? 1)
    if (game.youth === undefined) {
      const profile = teamProfiles.value.find((item) => item.id === selectedTeamProfileIds.value[0]
        && item.name.trim().toLocaleLowerCase() === game.teams[0].name.trim().toLocaleLowerCase())
      game.youth = isYouthTeam(profile?.catalogTeamId ?? '') || isYouthTeam(game.teams[0].name)
    }
    game.actions = game.actions.map((action) => action.type === 'foul' && action.period === undefined
      ? { ...action, period }
      : action)
    if (!game.clock && game.period !== 0) game.clock = newPeriodClock(period, game.youth)
    updateClock()
  }

  function updateClock() {
    const now = Date.now()
    clockNow.value = now
    if (!game.clock) return
    const next = reconcileClock(game.clock, game.period ?? 1, game.youth ?? false, now)
    if (game.clock.phase === 'period' && game.clock.deadline !== null && game.clock.deadline <= now && (game.period ?? 0) > 0) {
      recordPeriodEvent('period_end', game.period ?? 1, game.clock.deadline)
    }
    if (next !== game.clock) game.clock = next
  }

  function toggleClock() {
    updateClock()
    if (!game.clock || !game.gameStarted) return
    game.clock = game.clock.deadline === null
      ? startClock(game.clock, clockNow.value)
      : pauseClock(game.clock, clockNow.value)
  }

  onMounted(async () => {
    let hasSavedSelection = false
    let loadedGame: GameState | null = null
    try {
      const savedState = loadGameState(currentLocale.value)
      if (savedState) {
        loadedGame = savedState
        Object.assign(game, savedState)
        selectedTeamId.value = game.teams[0].id
      }
    } catch (error) {
      console.error('Failed to load saved game state.', error)
      storageErrorKey.value = 'errors.loadGame'
    }

    try {
      teamProfiles.value = loadTeamProfiles()
      const savedSelection = loadTeamProfileSelection()
      const validSelection = savedSelection?.every((id) => teamProfiles.value.some((profile) => profile.id === id))
      const needsLegacyMigration = !hasSavedTeamProfiles()
        && loadedGame !== null
        && (loadedGame.gameStarted || loadedGame.actions.length > 0)
      if (needsLegacyMigration && loadedGame) {
        teamProfiles.value = loadedGame.teams.map((team) => ({
          id: `migrated-${team.id}`,
          name: team.name,
          players: loadedGame.players
            .filter((player) => player.teamId === team.id)
            .map((player) => ({
              id: player.id,
              name: player.name,
              jerseyNumber: player.jerseyNumber,
              isParticipating: true,
              isOnCourt: player.isOnCourt,
            })),
          coaches: [],
        }))
        selectedTeamProfileIds.value = [teamProfiles.value[0].id, teamProfiles.value[1].id]
        try {
          saveTeamProfiles(teamProfiles.value)
          saveTeamProfileSelection(selectedTeamProfileIds.value)
        } catch (error) {
          console.error('Failed to migrate the active game to team profiles.', error)
          storageErrorKey.value = 'errors.saveTeams'
        }
        teamSetupComplete.value = true
        teamSetupOpen.value = false
      } else if (savedSelection && validSelection) {
        selectedTeamProfileIds.value = savedSelection
        hasSavedSelection = true
      } else {
        selectedTeamProfileIds.value = [
          teamProfiles.value[0].id,
          teamProfiles.value[1]?.id ?? teamProfiles.value[0].id,
        ]
      }
      if (!needsLegacyMigration) {
        teamSetupComplete.value = hasSavedTeamProfiles() && hasSavedSelection
        const hasExistingGame = !!loadedGame && (loadedGame.period !== undefined || loadedGame.gameStarted || loadedGame.actions.length > 0)
        teamSetupOpen.value = !hasExistingGame
      }
    } catch (error) {
      console.error('Failed to load team profiles.', error)
      storageErrorKey.value = 'errors.loadTeams'
      teamProfiles.value = createDefaultTeamProfiles()
      teamSetupComplete.value = false
      teamSetupOpen.value = true
    }
    if (loadedGame) initializeClock()

    try {
      matchLink.value = loadMatchLink()
      if (matchLink.value) {
        matchSyncStatus.value = !matchSyncConfigured ? 'error' : navigator.onLine ? 'syncing' : 'offline'
      }
    } catch (error) {
      console.error('Failed to load shared-match information.', error)
      storageErrorKey.value = 'errors.loadMatch'
    }
    previousActions = JSON.parse(JSON.stringify(game.actions)) as GameAction[]
    initializing = false
    if (matchLink.value && matchSyncConfigured && navigator.onLine) scheduleMatchSync()
    teamSetupInitializing.value = false
    clockTimer = window.setInterval(updateClock, 250)

    try {
      teamCatalog.value = await loadZoebasTeams()
    } catch (error) {
      console.error('Failed to load the Zoebas team catalog.', error)
      teamCatalogError.value = t('errors.loadTeamCatalog')
    } finally {
      teamCatalogLoading.value = false
    }
  })

  watch(
    () => game.actions,
    (actions) => {
      const nextActions = JSON.parse(JSON.stringify(actions)) as GameAction[]
      if (initializing) {
        previousActions = nextActions
        return
      }

      const link = matchLink.value
      const previousById = new Map(previousActions.map((action) => [action.id, action]))
      const nextById = new Map(nextActions.map((action) => [action.id, action]))
      const events: MatchEvent[] = []
      if (link) {
        for (const previous of previousActions) {
          const current = nextById.get(previous.id)
          if (!current) events.push(makeMatchEvent(previous, 'action_removed', link))
          else if (JSON.stringify(previous) !== JSON.stringify(current)) {
            events.push(makeMatchEvent(current, 'action_updated', link))
          }
        }
        for (const current of nextActions) {
          if (!previousById.has(current.id)) events.push(makeMatchEvent(current, 'action_added', link))
        }
      }
      if (!events.length) {
        previousActions = nextActions
        return
      }

      try {
        appendMatchEvents(events)
        // Advance the baseline only once the events are stored, so a failed write is retried on the next change.
        previousActions = nextActions
        matchSyncStatus.value = navigator.onLine ? 'syncing' : 'offline'
        scheduleMatchSync()
      } catch (error) {
        console.error('Failed to store match events locally.', error)
        storageErrorKey.value = 'errors.saveMatchEvents'
        matchSyncStatus.value = 'error'
      }
    },
    { deep: true, flush: 'sync' },
  )

  watch(
    game,
    (value) => {
      try {
        saveGameState(value)
        if (storageErrorKey.value === 'errors.saveGame' || storageErrorKey.value === 'errors.loadGame') {
          storageErrorKey.value = ''
        }
      } catch (error) {
        console.error('Failed to save game state.', error)
        storageErrorKey.value = 'errors.saveGame'
      }
    },
    { deep: true },
  )

  function handleOnline() {
    if (matchLink.value) scheduleMatchSync()
  }

  onMounted(() => window.addEventListener('online', handleOnline))
  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    if (clockTimer !== undefined) window.clearInterval(clockTimer)
  })

  return {
    game,
    selectedTeamId,
    selectedTeam,
    teamPlayers,
    onCourtPlayers,
    pickerPlayers,
    canStart,
    canStartNewMatch,
    scores,
    scoreNotification,
    teamStats,
    playerFouls,
    periodTeamFouls,
    clockDisplay,
    recentActions,
    pendingAction,
    pendingScorerId,
    pendingAssistId,
    pendingShotLocation,
    editingActionId,
    lineupEditorOpen,
    startingPeriod,
    draftCourtPlayerIds,
    teamProfiles,
    rosterEditProfile,
    selectedTeamProfileIds,
    teamSetupOpen,
    teamSetupInitializing,
    teamSetupComplete,
    canCancelTeamSetup,
    teamCatalog,
    teamCatalogLoading,
    teamCatalogError,
    lineupError,
    storageError,
    matchLink,
    matchSyncStatus,
    matchSyncError,
    matchSyncConfigured,
    playerName,
    addAction,
    addOpponentScore,
    removeOpponentScore,
    selectPlayer,
    pendingFoulType,
    pendingTurnoverType,
    finishFoulAction,
    finishTurnoverAction,
    selectScorer,
    finishShotAction,
    cancelPendingAction,
    editAction,
    undoLastAction,
    toggleGame,
    toggleClock,
    applyTeamSetup,
    saveGameRoster,
    openTeamSetup,
    cancelTeamSetup,
    openLineupEditor,
    beginPeriod,
    toggleDraftCourtPlayer,
    saveLineup,
    cancelLineupEdit,
    createSharedMatch,
    joinSharedMatch,
  }
}
