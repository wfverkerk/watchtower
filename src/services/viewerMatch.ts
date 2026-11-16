import { errorMessage, isRecord } from '../domain/guards'
import type { GameState } from '../domain/game'
import { ensureAnonymousUser, getSupabaseClient } from './supabaseClient'
import { officialLiveActions, parseEvent, type LiveAction, type LiveEvent } from './liveMatch'
import { parseLiveState, type LiveState } from './matchLiveState'

// Everything a viewer sees of a match. Events are applied one by one as they arrive, so a viewer does not
// download the whole match again for every action.
export type ViewerMatch = {
  ownerId: string
  sourceId: string
  scorerId: string | null
  finishedAt: string | null
  events: LiveEvent[]
  state: LiveState | null
}

export function applyViewerEvent(events: LiveEvent[], event: LiveEvent): LiveEvent[] {
  if (events.some((item) => item.id === event.id)) return events
  return [...events, event].sort((a, b) => a.sequence - b.sequence)
}

export function applyViewerMatchRow(match: ViewerMatch, row: unknown): ViewerMatch {
  if (!isRecord(row)) return match
  return {
    ...match,
    scorerId: typeof row.scorer_id === 'string' ? row.scorer_id : null,
    sourceId: typeof row.live_tracker_id === 'string' ? row.live_tracker_id : match.ownerId,
    finishedAt: typeof row.finished_at === 'string' ? row.finished_at : null,
  }
}

export function applyViewerStateRow(match: ViewerMatch, row: unknown): ViewerMatch {
  return isRecord(row) ? { ...match, state: parseLiveState(row.state) } : match
}

export function viewerActions(game: GameState, match: ViewerMatch): LiveAction[] {
  return officialLiveActions(game, {
    sourceId: match.sourceId, ownerId: match.ownerId, scorerId: match.scorerId, events: match.events, links: [],
  })
}

export async function loadViewerMatch(matchId: string): Promise<ViewerMatch> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  await ensureAnonymousUser()
  const { data: row, error: rowError } = await client.from('shared_matches')
    .select('owner_id,scorer_id,live_tracker_id,finished_at').eq('id', matchId).single()
  if (rowError) throw new Error(rowError.message)
  if (!isRecord(row) || typeof row.owner_id !== 'string') throw new Error('Invalid match.')
  const { data: stateRow, error: stateError } = await client.from('match_live_state')
    .select('state').eq('match_id', matchId).maybeSingle()
  if (stateError) throw new Error(stateError.message)

  const events: LiveEvent[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('match_events')
      .select('id,tracker_id,tracker_name,action_id,event_type,action_data,sequence_id')
      .eq('match_id', matchId).order('sequence_id').range(offset, offset + 499)
    if (error) throw new Error(error.message)
    if (!Array.isArray(data)) throw new Error('Invalid match events.')
    events.push(...data.map(parseEvent))
    if (data.length < 500) break
  }
  return applyViewerMatchRow({
    ownerId: row.owner_id, sourceId: row.owner_id, scorerId: null, finishedAt: null, events,
    state: parseLiveState(stateRow?.state),
  }, row)
}

export async function watchViewerMatch(
  matchId: string,
  onChange: (match: ViewerMatch) => void,
  onError: (message: string) => void,
) {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  await ensureAnonymousUser()
  let stopped = false
  let current: ViewerMatch | null = null

  function publish(next: ViewerMatch) {
    current = next
    if (!stopped) onChange(next)
  }
  async function reload() {
    try {
      const next = await loadViewerMatch(matchId)
      publish(next)
      if (!stopped) onError('')
    } catch (error) {
      if (!stopped) {
        console.error('Failed to load the match.', error)
        onError(errorMessage(error))
      }
    }
  }

  const channel = client.channel(`viewer-${matchId}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` }, (payload) => {
      if (!current) return
      try {
        publish({ ...current, events: applyViewerEvent(current.events, parseEvent(payload.new)) })
      } catch {
        void reload()
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shared_matches', filter: `id=eq.${matchId}` }, (payload) => {
      if (current) publish(applyViewerMatchRow(current, payload.new))
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_live_state', filter: `match_id=eq.${matchId}` }, (payload) => {
      if (current) publish(applyViewerStateRow(current, payload.new))
    })
    .subscribe((status) => {
      if (stopped) return
      if (status === 'SUBSCRIBED') void reload()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onError('Live connection interrupted. Waiting to reconnect.')
      }
    })
  return () => {
    stopped = true
    void client.removeChannel(channel)
  }
}
