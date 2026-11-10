import type { GameState } from '../domain/game'
import type { MatchEvent, MatchLink } from './matchEventLog'
import { ensureAnonymousUser, getSupabaseClient } from './supabaseClient'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The shared-match service returned invalid data.')
  }
  return value as Record<string, unknown>
}

function parseMatchResponse(value: unknown) {
  const response = record(Array.isArray(value) ? value[0] : value)
  if (typeof response.match_id !== 'string'
    || typeof response.join_code !== 'string'
    || typeof response.tracker_id !== 'string'
    || typeof response.display_name !== 'string'
    || typeof response.game_data !== 'object'
    || response.game_data === null) {
    throw new Error('The shared-match service returned incomplete data.')
  }
  return {
    link: {
      matchId: response.match_id,
      joinCode: response.join_code,
      trackerId: response.tracker_id,
      displayName: response.display_name,
    } satisfies MatchLink,
    gameData: response.game_data as GameState,
  }
}

export async function createSharedMatch(gameData: GameState, displayName: string) {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const trackerId = await ensureAnonymousUser()
  const { data, error } = await supabase.rpc('create_shared_match', {
    p_game_data: gameData,
    p_display_name: displayName.trim(),
  })
  if (error) throw error
  const response = record(data)
  const result = parseMatchResponse({
    match_id: response.match_id,
    join_code: response.join_code,
    tracker_id: trackerId,
    display_name: displayName.trim(),
    game_data: response.game_data,
  })
  return result
}

export async function joinSharedMatch(joinCode: string, displayName: string) {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const trackerId = await ensureAnonymousUser()
  const { data, error } = await supabase.rpc('join_shared_match', {
    p_join_code: joinCode.trim().toUpperCase(),
    p_display_name: displayName.trim(),
  })
  if (error) throw error
  const response = record(data)
  return parseMatchResponse({
    ...response,
    tracker_id: trackerId,
    display_name: displayName.trim(),
  })
}

export async function uploadMatchEvents(events: MatchEvent[]) {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  for (let offset = 0; offset < events.length; offset += 100) {
    const batch = events.slice(offset, offset + 100)
    const { error } = await supabase.from('match_events').upsert(
      batch.map((event) => ({
        id: event.id,
        match_id: event.matchId,
        tracker_id: event.trackerId,
        tracker_name: event.trackerName,
        action_id: event.actionId,
        event_type: event.type,
        action_data: event.action,
        occurred_at: new Date(event.occurredAt).toISOString(),
      })),
      { onConflict: 'id', ignoreDuplicates: true },
    )
    if (error) throw error
  }
}
