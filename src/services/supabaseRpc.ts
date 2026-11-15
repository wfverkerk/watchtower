import { ensureAnonymousUser, getSupabaseClient } from './supabaseClient'

export async function callRpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  await ensureAnonymousUser()
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}
