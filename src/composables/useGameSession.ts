import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  canStartGame as isReadyToStart,
  createInitialGameState,
  getPlayerName,
  getRecentActions,
  getScore,
  getTeamStats,
  parseGameState,
  undoLastAction as undoActions,
  updateActionPlayer,
  updateScoringPlay,
  type GameAction,
  type GameState,
  type Player,
  type ShotLocation,
  type StatType,
} from '../domain/game'
import { loadGameState, saveGameState } from '../services/gameStorage'
import {
  appendMatchEvents,
  loadMatchEvents,
  loadMatchLink,
  markMatchEventsSynced,
  saveMatchLink,
  type MatchEvent,
  type MatchEventType,
  type MatchLink,
} from '../services/matchEventLog'
import { createSharedMatch as createSharedMatchRecord, joinSharedMatch as joinSharedMatchRecord, uploadMatchEvents } from '../services/sharedMatch'
import { ensureAnonymousUser, isSupabaseConfigured } from '../services/supabaseClient'
import { isAppLocale, useLocale } from '../i18n/useLocale'

type PendingAction = { type: StatType; value: number }

export function useGameSession() {
  const { t, locale, displayPlayerName } = useLocale()
  const currentLocale = computed(() => isAppLocale(locale.value) ? locale.value : 'nl')
  const game = reactive<GameState>(createInitialGameState(currentLocale.value))
  const selectedTeamId = ref(game.teams[0].id)
  const selectedPlayerId = ref('')
  const pendingAction = ref<PendingAction | null>(null)
  const pendingScorerId = ref('')
  const pendingAssistId = ref<string | 'none' | null>(null)
  const pendingShotLocation = ref<ShotLocation | null>(null)
  const editingActionId = ref<string | null>(null)
  const lineupEditorOpen = ref(false)
  const draftCourtPlayerIds = ref<string[]>([])
  const newPlayerName = ref('')
  const newPlayerNumber = ref('')
  const playerFormErrorKey = ref('')
  const lineupErrorKey = ref('')
  const editingPlayerId = ref('')
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

  const selectedTeam = computed(() =>
    game.teams.find((team) => team.id === selectedTeamId.value) ?? game.teams[0],
  )
  const teamPlayers = computed(() => game.players.filter((player) => player.teamId === selectedTeamId.value))
  const onCourtPlayers = computed(() => teamPlayers.value.filter((player) => player.isOnCourt))
  const pickerPlayers = computed(() => editingActionId.value ? teamPlayers.value : onCourtPlayers.value)
  const canStart = computed(() => isReadyToStart(game))
  const scores = computed(() => getScore(game))
  const teamStats = computed(() => getTeamStats(game))
  const recentActions = computed(() => getRecentActions(game, 8, t('app.unknownPlayer')))
  const playerFormError = computed(() => playerFormErrorKey.value ? t(playerFormErrorKey.value) : '')
  const lineupError = computed(() => lineupErrorKey.value ? t(lineupErrorKey.value) : '')
  const storageError = computed(() => storageErrorKey.value ? t(storageErrorKey.value) : '')

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

      const pendingEvents = loadMatchEvents().filter((event) => event.matchId === link.matchId && !event.synced)
      if (pendingEvents.length === 0) {
        matchSyncStatus.value = 'synced'
        matchSyncError.value = ''
        return
      }

      matchSyncStatus.value = 'syncing'
      matchSyncError.value = ''
      await uploadMatchEvents(pendingEvents)
      markMatchEventsSynced(pendingEvents.map((event) => event.id))
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
      }
      const created = await createSharedMatchRecord(gameData, displayName)
      saveMatchLink(created.link)
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
      saveMatchLink(joined.link)
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
    return displayPlayerName(getPlayerName(game, playerId, t('app.unknownPlayer')))
  }

  function cancelPendingAction() {
    pendingAction.value = null
    pendingScorerId.value = ''
    pendingAssistId.value = null
    pendingShotLocation.value = null
    editingActionId.value = null
    if (game.gameStarted) selectedTeamId.value = 'home'
  }

  function addAction(type: StatType, value = 1) {
    if (!game.gameStarted) return
    selectedTeamId.value = 'home'
    editingActionId.value = null
    pendingAction.value = { type, value }
    pendingScorerId.value = ''
    pendingAssistId.value = type === 'score' && value > 1 ? 'none' : null
    pendingShotLocation.value = null
  }

  function selectPlayer(playerId: string) {
    const action = pendingAction.value
    if (!action || !game.gameStarted) return
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
      || !pendingShotLocation.value
      || (action.type === 'score' && pendingAssistId.value === null)
    ) return

    const shotLocation = pendingShotLocation.value
    if (action.type === 'score') {
      game.actions = updateScoringPlay(game.actions, {
        actionId: editingActionId.value ?? undefined,
        teamId: selectedTeamId.value,
        scorerId: pendingScorerId.value,
        value: action.value,
        assistPlayerId: pendingAssistId.value === 'none' ? null : pendingAssistId.value,
        shotLocation,
        createdAt: Date.now(),
        createId: () => crypto.randomUUID(),
      })
    } else if (editingActionId.value) {
      game.actions = game.actions.map((item) => item.id === editingActionId.value
        ? { ...item, playerId: pendingScorerId.value, shotLocation }
        : item)
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
  }

  function undoLastAction() {
    game.actions = undoActions(game.actions)
  }

  function toggleGame() {
    if (!game.gameStarted && !canStart.value) return
    if (!game.gameStarted) selectedTeamId.value = 'home'
    game.gameStarted = !game.gameStarted
  }

  function savePlayer() {
    const name = newPlayerName.value.trim()
    const number = newPlayerNumber.value.trim()
    if (!name || !/^\d{1,2}$/.test(number) || Number(number) > 99) {
      playerFormErrorKey.value = 'errors.invalidPlayer'
      return
    }

    const duplicateNumber = game.players.some((player) =>
      player.teamId === selectedTeamId.value
        && player.id !== editingPlayerId.value
        && Number(player.jerseyNumber) === Number(number),
    )
    if (duplicateNumber) {
      playerFormErrorKey.value = 'errors.duplicateNumber'
      return
    }

    if (editingPlayerId.value) {
      const player = game.players.find((item) => item.id === editingPlayerId.value)
      if (player) {
        player.name = name
        player.jerseyNumber = number
      }
    } else {
      const player: Player = {
        id: crypto.randomUUID(),
        name,
        teamId: selectedTeamId.value,
        jerseyNumber: number,
        isOnCourt: teamPlayers.value.filter((item) => item.isOnCourt).length < 5,
      }
      game.players.push(player)
      selectedPlayerId.value = player.id
    }
    cancelPlayerEdit()
  }

  function editPlayer(player: Player) {
    editingPlayerId.value = player.id
    newPlayerName.value = player.name
    newPlayerNumber.value = player.jerseyNumber
    playerFormErrorKey.value = ''
  }

  function cancelPlayerEdit() {
    editingPlayerId.value = ''
    newPlayerName.value = ''
    newPlayerNumber.value = ''
    playerFormErrorKey.value = ''
  }

  function removePlayer(playerId: string) {
    if (game.actions.some((action) => action.playerId === playerId)) return
    game.players = game.players.filter((player) => player.id !== playerId)
    if (selectedPlayerId.value === playerId) selectedPlayerId.value = ''
    if (editingPlayerId.value === playerId) cancelPlayerEdit()
  }

  function togglePregamePlayer(player: Player) {
    const activeCount = teamPlayers.value.filter((item) => item.isOnCourt).length
    if (!player.isOnCourt && activeCount >= 5) {
      lineupErrorKey.value = 'errors.maxOnCourt'
      return
    }
    player.isOnCourt = !player.isOnCourt
    lineupErrorKey.value = ''
  }

  function playerHasActions(playerId: string) {
    return game.actions.some((action) => action.playerId === playerId)
  }

  function openLineupEditor() {
    draftCourtPlayerIds.value = onCourtPlayers.value.map((player) => player.id)
    lineupEditorOpen.value = true
  }

  function toggleDraftCourtPlayer(playerId: string) {
    if (draftCourtPlayerIds.value.includes(playerId)) {
      draftCourtPlayerIds.value = draftCourtPlayerIds.value.filter((id) => id !== playerId)
    } else if (draftCourtPlayerIds.value.length < 5) {
      draftCourtPlayerIds.value = [...draftCourtPlayerIds.value, playerId]
    }
  }

  function saveLineup() {
    if (draftCourtPlayerIds.value.length !== 5) return
    for (const player of teamPlayers.value) {
      player.isOnCourt = draftCourtPlayerIds.value.includes(player.id)
    }
    if (pendingScorerId.value && !draftCourtPlayerIds.value.includes(pendingScorerId.value)) {
      cancelPendingAction()
    }
    lineupEditorOpen.value = false
  }

  function cancelLineupEdit() {
    lineupEditorOpen.value = false
    draftCourtPlayerIds.value = []
  }

  onMounted(() => {
    try {
      const savedState = loadGameState(currentLocale.value)
      if (savedState) {
        Object.assign(game, savedState)
        selectedTeamId.value = game.teams[0].id
      }
    } catch (error) {
      console.error('Failed to load saved game state.', error)
      storageErrorKey.value = 'errors.loadGame'
    }

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
      previousActions = nextActions
      if (!events.length) return

      try {
        appendMatchEvents(events)
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

  watch(selectedTeamId, () => {
    selectedPlayerId.value = game.players.find((player) => player.teamId === selectedTeamId.value)?.id ?? ''
    cancelPlayerEdit()
  })

  function handleOnline() {
    if (matchLink.value) scheduleMatchSync()
  }

  onMounted(() => window.addEventListener('online', handleOnline))
  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
  })

  return {
    game,
    selectedTeamId,
    selectedPlayerId,
    selectedTeam,
    teamPlayers,
    onCourtPlayers,
    pickerPlayers,
    canStart,
    scores,
    teamStats,
    recentActions,
    pendingAction,
    pendingScorerId,
    pendingAssistId,
    pendingShotLocation,
    editingActionId,
    lineupEditorOpen,
    draftCourtPlayerIds,
    newPlayerName,
    newPlayerNumber,
    playerFormError,
    lineupError,
    editingPlayerId,
    storageError,
    matchLink,
    matchSyncStatus,
    matchSyncError,
    matchSyncConfigured,
    playerName,
    addAction,
    selectPlayer,
    selectScorer,
    finishShotAction,
    cancelPendingAction,
    editAction,
    undoLastAction,
    toggleGame,
    savePlayer,
    editPlayer,
    cancelPlayerEdit,
    removePlayer,
    togglePregamePlayer,
    playerHasActions,
    openLineupEditor,
    toggleDraftCourtPlayer,
    saveLineup,
    cancelLineupEdit,
    createSharedMatch,
    joinSharedMatch,
  }
}
