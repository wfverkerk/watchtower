import { loadLocalMatches, updateLocalMatchSubmission } from './localMatches'
import { ensureAnonymousUser, getSupabaseClient } from './supabaseClient'

export async function submitLocalMatch(
  id: string, targetMatchId: string | null, displayName: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
) {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  const trackerId = await ensureAnonymousUser()
  const match = loadLocalMatches(storage).find((item) => item.id === id)
  if (!match) throw new Error('Local match not found.')
  if (!match.game.matchInfo?.startsAt) throw new Error('The saved match does not have a start time.')
  if (match.submission && (match.submission.trackerId !== trackerId || match.submission.targetMatchId !== targetMatchId)) {
    throw new Error('This pending submission must be retried with the original account and target.')
  }
  if (match.submission?.resultMatchId) return match.submission.resultMatchId
  const submission = { trackerId, targetMatchId }
  updateLocalMatchSubmission(id, submission, storage)
  const { data, error } = await client.rpc('submit_offline_match', {
    p_match_id: targetMatchId, p_local_id: id, p_game_data: match.game,
    p_starts_at: match.game.matchInfo.startsAt, p_display_name: displayName.trim(),
  })
  if (error) {
    if (error.code === 'P0001') updateLocalMatchSubmission(id, undefined, storage)
    throw new Error(error.message)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)
    || typeof data.match_id !== 'string') throw new Error('Invalid offline submission response.')
  updateLocalMatchSubmission(id, { ...submission, resultMatchId: data.match_id }, storage)
  return data.match_id
}
