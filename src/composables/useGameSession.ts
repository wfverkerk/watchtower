import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  canStartGame as isReadyToStart,
  createInitialGameState,
  foulCoachId,
  getPlayerName,
  getPlayerFouls,
  getPeriodTeamFouls,
  getRecentActions,
  getScore,
  getTeamStats,
  parseGameState,
  startNextPeriod,
  undoLastAction as undoActions,
  isReboundType,
  updateActionPlayer,
  updateMissedShotPlay,
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
import { isYouthTeam, newPeriodClock, pauseClock, reconcileClock } from '../domain/gameClock'
import { lineupChanges } from '../domain/matchTimeline'
import { getEventFlow } from '../domain/eventFlow'
import { localDateKey } from '../domain/schedule'
import { loadGameState, saveGameState } from '../services/gameStorage'
import { loadLocalMatches, saveLocalMatch } from '../services/localMatches'
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
  invalidMatchEventsStorageKey,
  loadMatchEvents,
  loadMatchLink,
  saveMatchLink,
  syncQueuedMatchEvents,
  type MatchEvent,
  type MatchEventType,
  type MatchLink,
} from '../services/matchEventLog'
import {
  joinMatchSession, uploadMatchEvents, uploadMatchSnapshot,
} from '../services/sharedMatch'
import { loadPendingMatchSnapshots, queueMatchSnapshot, setMatchSnapshotBase, syncQueuedMatchSnapshots } from '../services/matchSnapshots'
import { ensureAnonymousUser, isSupabaseConfigured } from '../services/supabaseClient'
import { loadCachedZoebasTeams, loadZoebasTeams, saveCachedZoebasTeams, type ZoebasTeam } from '../services/zoebasTeams'
import { loadMatchScorers, restoreMyMatchSnapshot } from '../services/statistics'
import { currentLiveActions, loadLiveMatch } from '../services/liveMatch'
import { buildLiveState, uploadLiveState, type LiveState } from '../services/matchLiveState'
import type { ZoebasMatch } from '../services/zoebasMatches'
import { isAppLocale, useLocale } from '../i18n/useLocale'
import { errorMessage } from '../domain/guards'
import { isZoebasName, withStartingColors } from './teamColors'

type PendingAction = { type: StatType; value: number }

function cloneProfiles(profiles: TeamProfile[]) {
  return profiles.map((profile) => ({ ...profile, players: profile.players.map((player) => ({ ...player })) }))
}

export function useGameSession() {
  const { t, locale, displayPlayerName } = useLocale()
  const currentLocale = computed(() => isAppLocale(locale.value) ? locale.value : 'nl')
  const game = reactive<GameState>(createInitialGameState(currentLocale.value))
  const selectedTeamId = ref(game.teams[0].id)
  const pendingAction = ref<PendingAction | null>(null)
  const pendingFlow = computed(() => pendingAction.value ? getEventFlow(pendingAction.value) : [])
  const pendingFlowIndex = ref(0)
  const pendingScorerId = ref('')
  const pendingAssistId = ref<string | 'none' | null>(null)
  const pendingReboundId = ref<string | 'opponent' | 'none' | null>(null)
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
  const teamCatalogCached = ref(false)
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
  let liveStateTimer: number | undefined
  let lastLiveState = ''
  let clockTimer: number | undefined
  const clockNow = ref(Date.now())

  const selectedTeam = computed(() =>
    game.teams.find((team) => team.id === selectedTeamId.value) ?? game.teams[0],
  )
  const allTeamPeople = computed(() => game.players.filter((player) => player.teamId === selectedTeamId.value))
  const teamPeople = computed(() => allTeamPeople.value.filter((player) => player.isParticipating !== false))
  const teamPlayers = computed(() => teamPeople.value)
  const onCourtPlayers = computed(() => teamPlayers.value.filter((player) => player.isOnCourt))
  const foulCoach = computed<Player>(() => ({
    id: foulCoachId(selectedTeamId.value),
    name: t('controls.coach'),
    teamId: selectedTeamId.value,
    jerseyNumber: '',
    isOnCourt: false,
  }))
  const pickerPlayers = computed(() => {
    if (pendingAction.value?.type === 'foul') {
      return [...(editingActionId.value ? allTeamPeople.value : teamPeople.value), foulCoach.value]
    }
    return editingActionId.value ? allTeamPeople.value : onCourtPlayers.value
  })
  const canStart = computed(() => teamSetupComplete.value && (game.period === 0
    ? game.players.filter((player) => player.teamId === game.teams[0].id && player.isParticipating !== false).length >= 2
    : isReadyToStart(game)))
  const canCancelTeamSetup = computed(() => game.period !== undefined || game.gameStarted || game.actions.length > 0)
  const canStartNewMatch = computed(() => !game.gameStarted && (!!game.localFinishedAt || !!matchLink.value?.finished))
  const scores = computed(() => getScore(game))
  const teamStats = computed(() => getTeamStats(game))
  const playerFouls = computed(() => getPlayerFouls(game.actions))
  const periodTeamFouls = computed(() => getPeriodTeamFouls(game))
  const recentActions = computed(() => getRecentActions(game, game.actions.length, t('app.unknownPlayer')))
  const lineupError = computed(() => lineupErrorKey.value ? t(lineupErrorKey.value) : '')
  const storageError = computed(() => storageErrorKey.value ? t(storageErrorKey.value) : '')
  const rosterEditProfile = computed(() => {
    const home = game.teams[0]
    const homePlayers = game.players.filter((player) => player.teamId === home.id)
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

  // Viewers follow the lineup, period and substitutions through this small shared state; only the scorer can write it.
  const liveState = computed(() => JSON.stringify(buildLiveState(game)))

  async function pushLiveState() {
    liveStateTimer = undefined
    const link = matchLink.value
    if (!matchSyncConfigured || !link || !navigator.onLine) return
    const serialized = liveState.value
    if (serialized === lastLiveState) return
    try {
      await uploadLiveState(link.matchId, JSON.parse(serialized) as LiveState)
      lastLiveState = serialized
    } catch (error) {
      // Registrations that are not the scorer's, such as on older matches, are simply not shared.
      console.debug('The live state was not shared.', error)
    }
  }

  function scheduleLiveState() {
    if (!matchLink.value) return
    if (liveStateTimer !== undefined) window.clearTimeout(liveStateTimer)
    liveStateTimer = window.setTimeout(() => void pushLiveState(), 800)
  }

  async function syncPendingMatchEvents() {
    if (syncInProgress) {
      syncRequested = true
      return
    }
    const link = matchLink.value
    if (!matchSyncConfigured) return
    syncInProgress = true
    try {
      const queuedEvents = loadMatchEvents()
      const queuedSnapshots = loadPendingMatchSnapshots()
      if (!link && !queuedEvents.length && !queuedSnapshots.length) {
        matchSyncStatus.value = 'local'
        matchSyncError.value = ''
        return
      }
      if (!navigator.onLine) {
        matchSyncStatus.value = 'offline'
        return
      }
      const currentTrackerId = await ensureAnonymousUser()
      if (link && currentTrackerId !== link.trackerId) {
        throw new Error('This device is signed in as a different tracker. Rejoin the match to continue syncing.')
      }

      if (queuedEvents.length || queuedSnapshots.length) matchSyncStatus.value = 'syncing'
      matchSyncError.value = ''
      await syncQueuedMatchEvents(currentTrackerId, uploadMatchEvents)
      await syncQueuedMatchSnapshots(currentTrackerId, uploadMatchSnapshot)
      if (link && !link.finished && matchLink.value?.matchId === link.matchId) {
        const status = await loadMatchScorers(link.matchId)
        if (status.finishedAt && matchLink.value?.matchId === link.matchId) markMatchFinished()
      }
      const hasPending = loadMatchEvents().some((event) => !event.synced) || loadPendingMatchSnapshots().length > 0
      matchSyncStatus.value = hasPending ? 'syncing' : matchLink.value ? 'synced' : 'local'
      if (hasPending) syncRequested = true
    } catch (error) {
      console.error('Failed to sync match events.', error)
      matchSyncError.value = errorMessage(error)
      matchSyncStatus.value = 'error'
    } finally {
      syncInProgress = false
      const shouldRunAgain = syncRequested
      syncRequested = false
      if (shouldRunAgain && matchSyncStatus.value !== 'error') scheduleMatchSync()
    }
  }

  async function joinSharedMatch(matchId: string, displayName: string, side: 'home' | 'away' = 'home') {
    if (!matchSyncConfigured) {
      matchSyncError.value = t('sync.notConfigured')
      return false
    }
    try {
      if (!game.localFinishedAt && !matchLink.value?.finished && (game.period !== undefined || game.actions.length)) {
        throw new Error(t('sessions.finishFirst'))
      }
      const joined = await joinMatchSession(matchId, displayName)
      const initialGame = parseGameState(joined.gameData, currentLocale.value)
      if (loadMatchEvents().some((event) => event.matchId === joined.link.matchId && !event.synced)) {
        throw new Error('Pending actions must be synchronized before rejoining this match.')
      }
      const sessionTeams = initialGame.teams.map((team) => ({ ...team }))
      const restored = await restoreMyMatchSnapshot(joined.link.matchId, initialGame)
      if (restored.revision === 0 && side === 'away') {
        restored.game.teams = [{ ...restored.game.teams[1] }, { ...restored.game.teams[0] }]
      }
      const awaySide = restored.game.teams[0].id !== sessionTeams[0].id
      if (restored.revision === 0) {
        const live = await loadLiveMatch(joined.link.matchId)
        const opponentId = restored.game.teams[1].id
        restored.game.actions = currentLiveActions(initialGame, live)
          .filter((item) => item.trackerId === live.sourceId)
          .flatMap(({ action }) => !awaySide ? [action]
            : action.type === 'score' && action.teamId === opponentId ? [{ ...action, playerId: null }] : [])
      }
      if (awaySide) {
        restored.game.teams[0].color = sessionTeams[0].color
        restored.game.teams[1].color = sessionTeams[1].color
        restored.game.catalogTeamId = undefined
      }
      const scorerStatus = await loadMatchScorers(joined.link.matchId)
      setMatchSnapshotBase(joined.link.matchId, joined.link.trackerId, restored.revision)
      const sharedGame = restored.game
      if (scorerStatus.finishedAt) {
        joined.link.finished = true
        sharedGame.gameStarted = false
        if (sharedGame.clock) sharedGame.clock = pauseClock(sharedGame.clock, Date.now())
      }
      initializing = true
      game.teams = sharedGame.teams
      game.players = sharedGame.players
      game.actions = sharedGame.actions
      game.gameStarted = sharedGame.gameStarted
      game.period = sharedGame.period
      game.matchInfo = sharedGame.matchInfo
      game.catalogTeamId = sharedGame.catalogTeamId
      game.youth = sharedGame.youth
      game.clock = sharedGame.clock
      game.timeline = sharedGame.timeline ?? []
      game.localMatchId = undefined
      game.localFinishedAt = undefined
      teamSetupOpen.value = false
      teamSetupComplete.value = true
      initializeClock()
      saveMatchLink(joined.link)
      matchLink.value = joined.link
      if (restored.revision === 0 && game.actions.length) {
        appendMatchEvents(game.actions.map((action) => makeMatchEvent(action, 'action_added', joined.link)))
      }
      selectedTeamId.value = game.teams[0].id
      previousActions = JSON.parse(JSON.stringify(game.actions)) as GameAction[]
      initializing = false
      if (matchLink.value) {
        try {
          queueMatchSnapshot(matchLink.value.matchId, matchLink.value.trackerId, game)
        } catch (error) {
          console.error('Failed to store a match snapshot locally.', error)
          storageErrorKey.value = 'errors.saveMatchEvents'
          matchSyncStatus.value = 'error'
        }
      }
      matchSyncError.value = ''
      matchSyncStatus.value = 'synced'
      scheduleMatchSync()
      return true
    } catch (error) {
      initializing = false
      console.error('Failed to join a shared match.', error)
      matchSyncError.value = errorMessage(error)
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
    pendingFlowIndex.value = 0
    pendingScorerId.value = ''
    pendingAssistId.value = null
    pendingReboundId.value = null
    pendingShotLocation.value = null
    pendingFoulType.value = null
    pendingTurnoverType.value = 'turnover'
    editingActionId.value = null
    selectedTeamId.value = game.teams[0].id
  }

  function addAction(type: StatType, value = 1) {
    if (!game.gameStarted && !matchLink.value?.finished) return
    selectedTeamId.value = game.teams[0].id
    editingActionId.value = null
    pendingAction.value = { type, value }
    pendingFlowIndex.value = 0
    pendingScorerId.value = ''
    pendingAssistId.value = null
    pendingReboundId.value = null
    pendingShotLocation.value = null
    pendingFoulType.value = null
    pendingTurnoverType.value = 'turnover'
  }

  function notifyScore(teamId: string, value: 1 | 2 | 3) {
    scoreNotification.value = { id: ++scoreNotificationId, teamId, value }
  }

  function addOpponentScore(value: 1 | 2 | 3) {
    if (!game.gameStarted && !matchLink.value?.finished) return
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

  // Each answer moves to the next question; the last question saves the event.
  function advanceFlow() {
    if (pendingFlowIndex.value < pendingFlow.value.length - 1) {
      pendingFlowIndex.value += 1
      return
    }
    commitPendingAction()
  }

  function goToFlowStep(index: number) {
    if (index >= 0 && index <= pendingFlowIndex.value) pendingFlowIndex.value = index
  }

  function selectPlayer(playerId: string) {
    if (!pendingAction.value || (!game.gameStarted && !matchLink.value?.finished)) return
    pendingScorerId.value = playerId
    if (pendingAssistId.value === playerId) pendingAssistId.value = null
    advanceFlow()
  }

  function selectAssist(playerId: string | 'none') {
    if (!pendingAction.value) return
    pendingAssistId.value = playerId
    advanceFlow()
  }

  function selectRebound(playerId: string | 'opponent' | 'none') {
    if (!pendingAction.value) return
    pendingReboundId.value = playerId
    advanceFlow()
  }

  function chooseFoulType(foulType: FoulType) {
    if (pendingAction.value?.type !== 'foul') return
    if (foulType === 'P' && (playerFouls.value[pendingScorerId.value] ?? 0) >= 5
      && !(editingActionId.value && pendingFoulType.value === 'P')) return
    pendingFoulType.value = foulType
    advanceFlow()
  }

  function chooseTurnoverType(turnoverType: TurnoverType) {
    if (pendingAction.value?.type !== 'turnover') return
    pendingTurnoverType.value = turnoverType
    advanceFlow()
  }

  function commitPendingAction() {
    const action = pendingAction.value
    if (!action || !pendingScorerId.value || (!game.gameStarted && !matchLink.value?.finished)) return
    if (action.type === 'foul' && !pendingFoulType.value) return
    if (action.type === 'score') {
      commitScore(action)
    } else if (action.type === 'missed_shot') {
      commitMissedShot(action)
    } else {
      commitPlayerAction(action)
    }
    cancelPendingAction()
  }

  function commitScore(action: PendingAction) {
    if (action.value === 1) {
      if (editingActionId.value) {
        game.actions = updateActionPlayer(game.actions, editingActionId.value, pendingScorerId.value)
        return
      }
      game.actions.push({
        id: crypto.randomUUID(),
        playerId: pendingScorerId.value,
        teamId: selectedTeamId.value,
        type: 'score',
        value: action.value,
        createdAt: Date.now(),
        period: Math.max(1, game.period ?? 1),
      })
      notifyScore(selectedTeamId.value, 1)
      return
    }
    const shotLocation = pendingShotLocation.value ?? undefined
    game.actions = updateScoringPlay(game.actions, {
      actionId: editingActionId.value ?? undefined,
      teamId: selectedTeamId.value,
      scorerId: pendingScorerId.value,
      value: action.value,
      assistPlayerId: pendingAssistId.value === 'none' ? null : pendingAssistId.value,
      ...(shotLocation ? { shotLocation } : {}),
      period: Math.max(1, game.period ?? 1),
      createdAt: Date.now(),
      createId: () => crypto.randomUUID(),
    })
    if (!editingActionId.value && (action.value === 2 || action.value === 3)) {
      notifyScore(selectedTeamId.value, action.value)
    }
  }

  function commitMissedShot(action: PendingAction) {
    const shotLocation = pendingShotLocation.value ?? undefined
    game.actions = updateMissedShotPlay(game.actions, {
      actionId: editingActionId.value ?? undefined,
      teamId: selectedTeamId.value,
      otherTeamId: game.teams.find((team) => team.id !== selectedTeamId.value)?.id ?? selectedTeamId.value,
      shooterId: pendingScorerId.value,
      value: action.value,
      rebound: pendingReboundId.value,
      ...(shotLocation ? { shotLocation } : {}),
      period: Math.max(1, game.period ?? 1),
      createdAt: Date.now(),
      createId: () => crypto.randomUUID(),
    })
  }

  function commitPlayerAction(action: PendingAction) {
    if (action.type === 'foul') {
      if (editingActionId.value) {
        game.actions = game.actions.map((item) => item.id === editingActionId.value
          ? { ...item, playerId: pendingScorerId.value, foulType: pendingFoulType.value ?? undefined }
          : item)
        return
      }
      game.actions.push({
        id: crypto.randomUUID(),
        playerId: pendingScorerId.value,
        teamId: selectedTeamId.value,
        type: action.type,
        value: action.value,
        createdAt: Date.now(),
        foulType: pendingFoulType.value ?? undefined,
        period: Math.max(1, game.period ?? 1),
      })
      return
    }
    if (action.type === 'turnover') {
      if (editingActionId.value) {
        game.actions = game.actions.map((item) => item.id === editingActionId.value
          ? { ...item, playerId: pendingScorerId.value, turnoverType: pendingTurnoverType.value }
          : item)
        return
      }
      game.actions.push({
        id: crypto.randomUUID(),
        playerId: pendingScorerId.value,
        teamId: selectedTeamId.value,
        type: 'turnover',
        value: action.value,
        createdAt: Date.now(),
        turnoverType: pendingTurnoverType.value,
      })
      return
    }
    if (editingActionId.value) {
      game.actions = updateActionPlayer(game.actions, editingActionId.value, pendingScorerId.value)
      return
    }
    game.actions.push({
      id: crypto.randomUUID(),
      playerId: pendingScorerId.value,
      teamId: selectedTeamId.value,
      type: action.type,
      value: action.value,
      createdAt: Date.now(),
    })
  }

  function editAction(action: GameAction) {
    if (action.playerId === null) return
    selectedTeamId.value = action.teamId
    pendingAction.value = { type: action.type, value: action.value }
    pendingFlowIndex.value = 0
    editingActionId.value = action.id
    pendingScorerId.value = action.playerId
    const assist = action.groupId
      ? game.actions.find((item) => item.groupId === action.groupId && item.type === 'assist')
      : undefined
    pendingAssistId.value = action.type === 'score' && action.value > 1
      ? assist?.playerId ?? 'none'
      : null
    const rebound = action.type === 'missed_shot' && action.groupId
      ? game.actions.find((item) => item.groupId === action.groupId && isReboundType(item.type))
      : undefined
    pendingReboundId.value = action.type === 'missed_shot'
      ? rebound ? rebound.playerId ?? 'opponent' : 'none'
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
    manualStart = '',
    practice = false,
    opponentClub = '',
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
    const teams = withStartingColors(
      { id: 'home', name: homeProfile.name.trim(), zoebas: true },
      { id: 'away', name: opponentName, ...(opponentClub.trim() ? { club: opponentClub.trim() } : {}), zoebas: isZoebasName(opponentName) || isZoebasName(opponentClub) },
    )
    const players = [homeProfile, awayProfile].flatMap<Player>((profile, index) => [
      ...profile.players.filter((player) => player.isParticipating).map((player, playerIndex) => ({
        id: `${teams[index].id}-${player.id}`,
        name: player.name.trim(),
        teamId: teams[index].id,
        jerseyNumber: player.jerseyNumber,
        ...(player.statisticsPrivate ? { statisticsPrivate: true } : {}),
        isOnCourt: index === 1 && playerIndex < 5,
      })),
    ])
    const now = new Date()
    const matchInfo: GameMatchInfo | undefined = practice
      ? {
          id: `practice-${crypto.randomUUID()}`,
          date: localDateKey(now),
          startTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
          venue: '',
          startsAt: now.toISOString(),
          kind: 'practice',
        }
      : selectedMatch
      ? {
          id: selectedMatch.id,
          date: selectedMatch.date,
          startTime: selectedMatch.startTime,
          venue: selectedMatch.venue,
          startsAt: new Date(`${selectedMatch.date}T${selectedMatch.startTime}:00`).toISOString(),
        }
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(manualStart) && Number.isFinite(new Date(manualStart).getTime())
        ? { id: `manual-${crypto.randomUUID()}`, date: manualStart.slice(0, 10), startTime: manualStart.slice(11, 16), venue: '', startsAt: new Date(manualStart).toISOString() }
        : undefined
    const nextGame: GameState = {
      teams,
      players,
      actions: [],
      timeline: [],
      gameStarted: false,
      localMatchId: crypto.randomUUID(),
      period: 0,
      ...(!homeProfile.catalogTeamId.startsWith('local-') ? { catalogTeamId: homeProfile.catalogTeamId } : {}),
      youth: isYouthTeam(homeProfile.catalogTeamId) || isYouthTeam(homeProfile.name),
      ...(matchInfo ? { matchInfo } : {}),
    }
    const isValidRoster = (teamId: string) => {
      const teamPlayers = players.filter((player) => player.teamId === teamId)
      return teamPlayers.length >= 2
        && teamPlayers.every((player) => player.name && /^\d{1,2}$/.test(player.jerseyNumber))
        && new Set(teamPlayers.map((player) => Number(player.jerseyNumber))).size === teamPlayers.length
    }
    if (!isValidRoster('home')
      || (practice && (homeProfile.catalogTeamId.startsWith('local-') || !isValidRoster('away')))
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

    teamProfiles.value = cloneProfiles(profiles)
    selectedTeamProfileIds.value = [...profileIds]
    teamSetupComplete.value = true
    teamSetupOpen.value = false
    matchLink.value = null
    matchSyncStatus.value = 'local'
    matchSyncError.value = ''
    Object.assign(game, nextGame, { matchInfo, catalogTeamId: nextGame.catalogTeamId, clock: undefined, localFinishedAt: undefined })
    selectedTeamId.value = 'home'
    beginPeriod()
    if (matchSyncConfigured) scheduleMatchSync()
    return true
  }

  function updateSelectedProfilesFromGame() {
    const profiles = cloneProfiles(teamProfiles.value)
    for (const [index, teamId] of ['home', 'away'].entries()) {
      const profile = profiles.find((item) => item.id === selectedTeamProfileIds.value[index])
      const team = game.teams.find((item) => item.id === teamId)
      if (!profile || !team) continue
      profile.name = team.name.trim()
      for (const player of profile.players) {
        player.isParticipating = false
        player.isOnCourt = false
      }
      for (const player of game.players.filter((item) => item.teamId === teamId)) {
        const profilePlayer = profile.players.find((item) => item.id === player.id)
          ?? profile.players.find((item) => `${teamId}-${item.id}` === player.id)
        const profilePlayerId = profilePlayer?.id ?? player.id
        const updatedPlayer: TeamProfile['players'][number] = {
          id: profilePlayerId,
          name: player.name.trim(),
          jerseyNumber: player.jerseyNumber,
          ...(profilePlayer?.catalogName ? { catalogName: profilePlayer.catalogName } : {}),
          ...(profilePlayer?.statisticsPrivate || player.statisticsPrivate ? { statisticsPrivate: true } : {}),
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
    const onCourt = nextPlayers.filter((player) => player.teamId === homeId && player.isOnCourt)
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
    teamSetupOpen.value = true
  }

  function cancelTeamSetup(force = false) {
    if (force || canCancelTeamSetup.value) teamSetupOpen.value = false
  }

  function toggleGame() {
    if (matchLink.value?.finished) return
    if (!game.gameStarted) {
      if (!canStart.value) return
      if (game.period === 0) {
        beginPeriod()
        return
      }

      if (!updateSelectedProfilesFromGame()) return
      selectedTeamId.value = game.teams[0].id
    }
    if (game.gameStarted && game.clock) {
      updateClock()
      game.clock = pauseClock(game.clock, Date.now())
    }
    game.gameStarted = !game.gameStarted
  }

  function markMatchFinished() {
    if (!matchLink.value || matchLink.value.finished) return
    const finishedLink = { ...matchLink.value, finished: true }
    try {
      saveMatchLink(finishedLink)
    } catch (error) {
      console.error('Failed to save match completion locally.', error)
      storageErrorKey.value = 'errors.saveMatchEvents'
    }
    if (game.gameStarted) toggleGame()
    matchLink.value = finishedLink
  }

  function finishLocalMatch() {
    if (matchLink.value || game.localFinishedAt) return false
    const finishedAt = new Date().toISOString()
    const id = game.localMatchId ?? crypto.randomUUID()
    const finishedGame = parseGameState({
      ...game,
      localMatchId: id,
      localFinishedAt: finishedAt,
      gameStarted: false,
      ...(game.clock ? { clock: pauseClock(game.clock, Date.now()) } : {}),
    }, currentLocale.value)
    try {
      saveLocalMatch({ id, finishedAt, game: finishedGame })
      Object.assign(game, finishedGame)
      storageErrorKey.value = ''
      return true
    } catch (error) {
      console.error('Failed to archive the local match.', error)
      storageErrorKey.value = 'errors.saveGame'
      return false
    }
  }

  async function releaseFinishedMatch() {
    const link = matchLink.value
    if (loadLocalMatches().some((match) => match.submission && !match.submission.resultMatchId)) {
      throw new Error(t('statistics.syncBeforeSwitch'))
    }
    if (!link) {
      if (loadMatchEvents().length || loadPendingMatchSnapshots().length
        || window.localStorage.getItem(invalidMatchEventsStorageKey) !== null) throw new Error(t('statistics.syncBeforeSwitch'))
      return
    }
    if (matchSyncStatus.value !== 'synced') throw new Error(t('statistics.syncBeforeSwitch'))
    const status = await loadMatchScorers(link.matchId)
    if (!status.finishedAt || loadMatchEvents().length || loadPendingMatchSnapshots().length
      || window.localStorage.getItem(invalidMatchEventsStorageKey) !== null) {
      throw new Error(t('statistics.finishBeforeSwitch'))
    }
    saveMatchLink(null)
    matchLink.value = null
    matchSyncStatus.value = 'local'
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
              ...(player.statisticsPrivate ? { statisticsPrivate: true } : {}),
              isParticipating: true,
              isOnCourt: player.isOnCourt,
            })),
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
      if (matchLink.value?.finished) {
        game.gameStarted = false
        if (game.clock) game.clock = pauseClock(game.clock, Date.now())
      }
      if (matchLink.value || loadMatchEvents().length || loadPendingMatchSnapshots().length) {
        matchSyncStatus.value = !matchSyncConfigured ? 'error' : navigator.onLine ? 'syncing' : 'offline'
        if (!matchSyncConfigured) matchSyncError.value = t('sync.notConfigured')
      }
    } catch (error) {
      console.error('Failed to load shared-match information.', error)
      storageErrorKey.value = 'errors.loadMatch'
    }
    previousActions = JSON.parse(JSON.stringify(game.actions)) as GameAction[]
    initializing = false
    if (matchSyncConfigured && navigator.onLine) scheduleMatchSync()
    teamSetupInitializing.value = false
    clockTimer = window.setInterval(updateClock, 250)

    try {
      if (!navigator.onLine) {
        const cached = loadCachedZoebasTeams()
        if (!cached) throw new Error('No cached team catalog is available.')
        teamCatalog.value = cached
        teamCatalogCached.value = true
      } else {
        teamCatalog.value = await loadZoebasTeams()
        try {
          saveCachedZoebasTeams(teamCatalog.value)
        } catch (error) {
          console.error('Failed to cache the team catalog.', error)
          storageErrorKey.value = 'errors.saveTeams'
        }
      }
    } catch (error) {
      console.error('Failed to load the Zoebas team catalog.', error)
      try {
        const cached = loadCachedZoebasTeams()
        if (cached) {
          teamCatalog.value = cached
          teamCatalogCached.value = true
        } else teamCatalogError.value = t('errors.loadTeamCatalog')
      } catch (cacheError) {
        console.error('Failed to load the cached team catalog.', cacheError)
        teamCatalogError.value = t('errors.loadTeamCatalog')
      }
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

  watch(
    () => [game.teams, game.players, game.actions, game.matchInfo],
    () => {
      const link = matchLink.value
      if (initializing || !link) return
      try {
        queueMatchSnapshot(link.matchId, link.trackerId, game)
        matchSyncStatus.value = navigator.onLine ? 'syncing' : 'offline'
        scheduleMatchSync()
      } catch (error) {
        console.error('Failed to store a match snapshot locally.', error)
        storageErrorKey.value = 'errors.saveMatchEvents'
        matchSyncStatus.value = 'error'
      }
    },
    { deep: true, flush: 'sync' },
  )

  watch(liveState, scheduleLiveState)
  watch(() => matchLink.value?.matchId, () => {
    lastLiveState = ''
    scheduleLiveState()
  })

  function handleOnline() {
    if (matchSyncConfigured) {
      scheduleMatchSync()
      scheduleLiveState()
    }
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    scheduleLiveState()
  })
  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    if (liveStateTimer !== undefined) window.clearTimeout(liveStateTimer)
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
    recentActions,
    pendingAction,
    pendingScorerId,
    pendingAssistId,
    pendingReboundId,
    pendingFlow,
    pendingFlowIndex,
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
    teamCatalogCached,
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
    selectAssist,
    selectRebound,
    chooseFoulType,
    chooseTurnoverType,
    goToFlowStep,
    commitPendingAction,
    cancelPendingAction,
    editAction,
    undoLastAction,
    toggleGame,
    applyTeamSetup,
    saveGameRoster,
    openTeamSetup,
    cancelTeamSetup,
    openLineupEditor,
    beginPeriod,
    toggleDraftCourtPlayer,
    saveLineup,
    cancelLineupEdit,
    markMatchFinished,
    finishLocalMatch,
    releaseFinishedMatch,
    joinSharedMatch,
  }
}
