import type { GameAction, GameState } from '../domain/game'
import { getSupabaseClient, ensureAnonymousUser } from './supabaseClient'
import { callRpc } from './supabaseRpc'
import { isGameAction, type MatchEventType } from './matchEventLog'
import { errorMessage, isRecord } from '../domain/guards'

export type LiveEvent = {
  id: string
  trackerId: string
  trackerName: string
  actionId: string
  type: MatchEventType
  action: GameAction
  sequence: number
}

export type LiveMatch = {
  sourceId: string
  ownerId: string
  events: LiveEvent[]
  links: LiveScoreLink[]
}

export type LiveScoreLink = {
  sourceId: string
  contributorId: string
  contributorActionId: string
  mode: 'auto' | 'separate' | 'linked'
  sourceActionId: string | null
}

function parseEvent(value: unknown): LiveEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.tracker_id !== 'string'
    || typeof value.tracker_name !== 'string' || typeof value.action_id !== 'string'
    || (value.event_type !== 'action_added' && value.event_type !== 'action_updated' && value.event_type !== 'action_removed')
    || !isGameAction(value.action_data) || value.action_data.id !== value.action_id) {
    throw new Error('Invalid live match event.')
  }
  const sequence = Number(value.sequence_id)
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid live match event sequence.')
  return {
    id: value.id, trackerId: value.tracker_id, trackerName: value.tracker_name,
    actionId: value.action_id, type: value.event_type, action: value.action_data, sequence,
  }
}

export async function loadLiveMatch(matchId: string): Promise<LiveMatch> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  await ensureAnonymousUser()
  const { data: match, error: matchError } = await client.from('shared_matches')
    .select('live_tracker_id,owner_id').eq('id', matchId).single()
  if (matchError) throw new Error(matchError.message)
  if (!isRecord(match) || (match.live_tracker_id !== null && typeof match.live_tracker_id !== 'string')
    || typeof match.owner_id !== 'string') throw new Error('Invalid live match source.')
  const events: LiveEvent[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('match_events')
      .select('id,tracker_id,tracker_name,action_id,event_type,action_data,sequence_id')
      .eq('match_id', matchId).order('sequence_id').range(offset, offset + 499)
    if (error) throw new Error(error.message)
    if (!Array.isArray(data)) throw new Error('Invalid live match events.')
    events.push(...data.map(parseEvent))
    if (data.length < 500) break
  }
  const links: LiveScoreLink[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('match_score_links')
      .select('source_tracker_id,contributor_id,contributor_action_id,mode,source_action_id')
      .eq('match_id', matchId).order('source_tracker_id').order('contributor_id').order('contributor_action_id').range(offset, offset + 499)
    if (error) throw new Error(error.message)
    if (!Array.isArray(data)) throw new Error('Invalid score links.')
    for (const row of data) {
      if (!isRecord(row) || typeof row.source_tracker_id !== 'string' || typeof row.contributor_id !== 'string'
        || typeof row.contributor_action_id !== 'string'
        || (row.mode !== 'auto' && row.mode !== 'separate' && row.mode !== 'linked')
        || !(row.source_action_id === null || typeof row.source_action_id === 'string')) throw new Error('Invalid score link.')
      links.push({
        sourceId: row.source_tracker_id, contributorId: row.contributor_id, contributorActionId: row.contributor_action_id,
        mode: row.mode, sourceActionId: row.source_action_id,
      })
    }
    if (data.length < 500) break
  }
  return { sourceId: match.live_tracker_id ?? match.owner_id, ownerId: match.owner_id, events, links }
}

export async function setLiveScoreLink(matchId: string, sourceId: string, contributorId: string, actionId: string, value: string) {
  const mode = value === 'auto' || value === 'separate' ? value : 'linked'
  await callRpc('set_match_score_link', {
    p_match_id: matchId, p_source_id: sourceId, p_contributor_id: contributorId,
    p_contributor_action_id: actionId, p_mode: mode, p_source_action_id: mode === 'linked' ? value : null,
  })
}

export async function watchLiveMatch(
  matchId: string,
  onChange: (match: LiveMatch) => void,
  onError: (message: string) => void,
) {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  await ensureAnonymousUser()
  let stopped = false
  let running = false
  let pending = false
  async function refresh() {
    if (running) { pending = true; return }
    running = true
    try {
      do {
        pending = false
        const match = await loadLiveMatch(matchId)
        if (!stopped) { onChange(match); onError('') }
      } while (pending && !stopped)
    } catch (error) {
      if (!stopped) {
        console.error('Failed to load live match.', error)
        onError(errorMessage(error))
      }
    } finally {
      running = false
      if (pending && !stopped) void refresh()
    }
  }
  const channel = client.channel(`match-events-${matchId}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` }, () => { void refresh() })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shared_matches', filter: `id=eq.${matchId}` }, () => { void refresh() })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_score_links', filter: `match_id=eq.${matchId}` }, () => { void refresh() })
    .subscribe((status) => {
      if (stopped) return
      if (status === 'SUBSCRIBED') void refresh()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onError('Live connection interrupted. Waiting to reconnect.')
      }
    })
  return () => {
    stopped = true
    void client.removeChannel(channel)
  }
}

export type LiveAction = { trackerId: string; trackerName: string; action: GameAction }

export function currentLiveActions(game: GameState, live: LiveMatch): LiveAction[] {
  const actions = new Map<string, LiveAction>()
  for (const action of game.actions) {
    actions.set(`${live.ownerId}:${action.id}`, { trackerId: live.ownerId, trackerName: '', action })
  }
  for (const event of [...live.events].sort((a, b) => a.sequence - b.sequence)) {
    const key = `${event.trackerId}:${event.actionId}`
    if (event.type === 'action_removed') actions.delete(key)
    else actions.set(key, { trackerId: event.trackerId, trackerName: event.trackerName, action: event.action })
  }
  return [...actions.values()].sort((a, b) => a.action.createdAt - b.action.createdAt)
}
