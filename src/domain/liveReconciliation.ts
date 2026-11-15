import type { GameAction, GameState } from './game'
import type { LiveAction, LiveScoreLink } from '../services/liveMatch'

export type ReconciledAction = LiveAction & {
  contributors: string[]
  uncertain: boolean
}

export function isScoreCandidate(source: GameAction, contribution: GameAction) {
  return source.type === 'score' && source.teamId === contribution.teamId && source.value === contribution.value
    && (source.period === contribution.period || source.period === undefined || contribution.period === undefined)
}

export function reconcileLiveScores(game: GameState, sourceId: string, actions: LiveAction[], links: LiveScoreLink[] = []) {
  const official: ReconciledAction[] = actions.filter((item) => item.trackerId === sourceId)
    .map((item) => ({ ...item, action: { ...item.action }, contributors: [], uncertain: false }))
  const additional: LiveAction[] = []
  const claimed = new Set<string>()
  const remote = actions.filter((item) => item.trackerId !== sourceId)
  const usedAssists = new Set<string>()
  const invalidLinks: LiveAction[] = []
  const findLink = (item: LiveAction) => links.find((entry) => entry.sourceId === sourceId && entry.contributorId === item.trackerId
      && entry.contributorActionId === item.action.id)
  const remoteScores = remote.filter((entry) => entry.action.type === 'score').sort((a, b) =>
    Number(findLink(b)?.mode === 'linked') - Number(findLink(a)?.mode === 'linked'))
  for (const item of remoteScores) {
    const link = findLink(item)
    if (link?.mode === 'separate') { additional.push(item); continue }
    const candidates = official.filter((entry) => isScoreCandidate(entry.action, item.action)
      && !claimed.has(`${item.trackerId}:${entry.action.id}`))
      .sort((a, b) => {
        const exactA = a.action.id === item.action.id ? 0 : 1
        const exactB = b.action.id === item.action.id ? 0 : 1
        return exactA - exactB
          || Math.abs(a.action.createdAt - item.action.createdAt) - Math.abs(b.action.createdAt - item.action.createdAt)
          || a.action.createdAt - b.action.createdAt
      })
    const target = link?.mode === 'linked'
      ? candidates.find((candidate) => candidate.action.id === link.sourceActionId)
      : candidates[0]
    if (!target) {
      if (link?.mode === 'linked') invalidLinks.push(item)
      additional.push(item)
      continue
    }
    claimed.add(`${item.trackerId}:${target.action.id}`)
    target.contributors.push(item.trackerName)
    target.uncertain ||= link?.mode !== 'linked'
      && (target.action.id !== item.action.id || target.action.period === undefined || item.action.period === undefined)
    const knownPlayer = item.action.playerId !== null
      && game.players.some((player) => player.id === item.action.playerId && player.teamId === item.action.teamId)
    if (target.action.playerId === null && knownPlayer) target.action.playerId = item.action.playerId
    if (!target.action.shotLocation && item.action.shotLocation) target.action.shotLocation = item.action.shotLocation

    const assist = item.action.groupId && remote.find((entry) =>
      entry.trackerId === item.trackerId && entry.action.type === 'assist'
      && entry.action.groupId === item.action.groupId)
    const hasAssist = target.action.groupId && official.some((entry) =>
      entry.action.type === 'assist' && entry.action.groupId === target.action.groupId)
    if (assist && !hasAssist && assist.action.playerId
      && game.players.some((player) => player.id === assist.action.playerId && player.teamId === item.action.teamId)) {
      const groupId = target.action.groupId ?? `live-${target.action.id}`
      target.action.groupId = groupId
      const action: GameAction = { ...assist.action, id: `live-${target.action.id}-${assist.action.id}`, groupId }
      official.push({ ...assist, trackerId: sourceId, action, contributors: [item.trackerName], uncertain: target.uncertain })
      usedAssists.add(`${assist.trackerId}:${assist.action.id}`)
    }
  }
  additional.push(...remote.filter((entry) => entry.action.type !== 'score'
    && !usedAssists.has(`${entry.trackerId}:${entry.action.id}`)))
  return { official, additional, invalidLinks }
}

export function enrichOfficialActions(game: GameState, officialId: string, contributions: LiveAction[], links: LiveScoreLink[] = []) {
  if (!contributions.length) return game.actions
  const official = game.actions.map((action) => ({ trackerId: officialId, trackerName: '', action }))
  return reconcileLiveScores(game, officialId, [...official, ...contributions], links).official.map((item) => item.action)
}
