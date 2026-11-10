import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  canStartGame as isReadyToStart,
  createInitialGameState,
  getPlayerName,
  getRecentActions,
  getScore,
  getTeamStats,
  undoLastAction as undoActions,
  updateActionPlayer,
  updateScoringPlay,
  type GameAction,
  type GameState,
  type Player,
  type StatType,
} from '../domain/game'
import { loadGameState, saveGameState } from '../services/gameStorage'

type PendingAction = { type: StatType; value: number }

export function useGameSession() {
  const game = reactive<GameState>(createInitialGameState())
  const selectedTeamId = ref(game.teams[0].id)
  const selectedPlayerId = ref('')
  const pendingAction = ref<PendingAction | null>(null)
  const pendingScorerId = ref('')
  const pendingAssistId = ref<string | 'none' | null>(null)
  const editingActionId = ref<string | null>(null)
  const lineupEditorOpen = ref(false)
  const draftCourtPlayerIds = ref<string[]>([])
  const newPlayerName = ref('')
  const newPlayerNumber = ref('')
  const playerFormError = ref('')
  const lineupError = ref('')
  const editingPlayerId = ref('')
  const storageError = ref('')

  const selectedTeam = computed(() =>
    game.teams.find((team) => team.id === selectedTeamId.value) ?? game.teams[0],
  )
  const teamPlayers = computed(() => game.players.filter((player) => player.teamId === selectedTeamId.value))
  const onCourtPlayers = computed(() => teamPlayers.value.filter((player) => player.isOnCourt))
  const pickerPlayers = computed(() => editingActionId.value ? teamPlayers.value : onCourtPlayers.value)
  const canStart = computed(() => isReadyToStart(game))
  const scores = computed(() => getScore(game))
  const teamStats = computed(() => getTeamStats(game))
  const recentActions = computed(() => getRecentActions(game))

  function playerName(playerId: string) {
    return getPlayerName(game, playerId)
  }

  function cancelPendingAction() {
    pendingAction.value = null
    pendingScorerId.value = ''
    pendingAssistId.value = null
    editingActionId.value = null
  }

  function addAction(type: StatType, value = 1) {
    if (!game.gameStarted) return
    editingActionId.value = null
    pendingAction.value = { type, value }
    pendingScorerId.value = ''
    pendingAssistId.value = type === 'score' && value > 1 ? 'none' : null
  }

  function selectPlayer(playerId: string) {
    const action = pendingAction.value
    if (!action || !game.gameStarted) return
    if (action.type === 'score') {
      selectScorer(playerId)
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

  function finishScoringAction() {
    const action = pendingAction.value
    if (!action || action.type !== 'score' || !pendingScorerId.value || pendingAssistId.value === null) return
    game.actions = updateScoringPlay(game.actions, {
      actionId: editingActionId.value ?? undefined,
      teamId: selectedTeamId.value,
      scorerId: pendingScorerId.value,
      value: action.value,
      assistPlayerId: pendingAssistId.value === 'none' ? null : pendingAssistId.value,
      createdAt: Date.now(),
      createId: () => crypto.randomUUID(),
    })
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
  }

  function undoLastAction() {
    game.actions = undoActions(game.actions)
  }

  function toggleGame() {
    if (!game.gameStarted && !canStart.value) return
    game.gameStarted = !game.gameStarted
  }

  function savePlayer() {
    const name = newPlayerName.value.trim()
    const number = newPlayerNumber.value.trim()
    if (!name || !/^\d{1,2}$/.test(number) || Number(number) > 99) {
      playerFormError.value = 'Vul een naam en een rugnummer van 0 t/m 99 in.'
      return
    }

    const duplicateNumber = game.players.some((player) =>
      player.teamId === selectedTeamId.value
        && player.id !== editingPlayerId.value
        && Number(player.jerseyNumber) === Number(number),
    )
    if (duplicateNumber) {
      playerFormError.value = 'Dit rugnummer is al in gebruik bij dit team.'
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
    playerFormError.value = ''
  }

  function cancelPlayerEdit() {
    editingPlayerId.value = ''
    newPlayerName.value = ''
    newPlayerNumber.value = ''
    playerFormError.value = ''
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
      lineupError.value = 'Er kunnen maximaal vijf spelers tegelijk in het veld staan.'
      return
    }
    player.isOnCourt = !player.isOnCourt
    lineupError.value = ''
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
      const savedState = loadGameState()
      if (!savedState) return
      Object.assign(game, savedState)
      selectedTeamId.value = game.teams[0].id
    } catch (error) {
      storageError.value = error instanceof Error
        ? `Wedstrijdgegevens laden is niet gelukt: ${error.message}`
        : 'Wedstrijdgegevens laden is niet gelukt.'
    }
  })

  watch(
    game,
    (value) => {
      try {
        saveGameState(value)
        storageError.value = ''
      } catch (error) {
        storageError.value = error instanceof Error
          ? `Opslaan op dit apparaat is niet gelukt: ${error.message}`
          : 'Opslaan op dit apparaat is niet gelukt.'
      }
    },
    { deep: true },
  )

  watch(selectedTeamId, () => {
    selectedPlayerId.value = game.players.find((player) => player.teamId === selectedTeamId.value)?.id ?? ''
    cancelPlayerEdit()
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
    editingActionId,
    lineupEditorOpen,
    draftCourtPlayerIds,
    newPlayerName,
    newPlayerNumber,
    playerFormError,
    lineupError,
    editingPlayerId,
    storageError,
    playerName,
    addAction,
    selectPlayer,
    selectScorer,
    finishScoringAction,
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
  }
}
