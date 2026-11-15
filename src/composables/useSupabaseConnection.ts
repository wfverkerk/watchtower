import { ref } from 'vue'
import { getSupabaseClient } from '../services/supabaseClient'

export type ConnectionState = 'checking' | 'online' | 'offline'

const checkIntervalMs = 60_000
const timeoutMs = 5_000
const connection = ref<ConnectionState>('checking')
let started = false

// A cheap read of a public table: it succeeds only when the online database answers.
async function checkConnection() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    connection.value = 'offline'
    return
  }
  let client: ReturnType<typeof getSupabaseClient>
  try {
    client = getSupabaseClient()
  } catch {
    connection.value = 'offline'
    return
  }
  if (!client) {
    connection.value = 'offline'
    return
  }
  const timeout = new Promise<'timeout'>((resolve) => { window.setTimeout(() => resolve('timeout'), timeoutMs) })
  const request = client.from('zoebas_teams').select('id').limit(1).then(({ error }) => (error ? 'error' : 'ok'))
  const result = await Promise.race([request, timeout]).catch(() => 'error')
  connection.value = result === 'ok' ? 'online' : 'offline'
}

export function useSupabaseConnection() {
  if (!started) {
    started = true
    void checkConnection()
    window.setInterval(() => { void checkConnection() }, checkIntervalMs)
    window.addEventListener('online', () => { void checkConnection() })
    window.addEventListener('offline', () => { connection.value = 'offline' })
  }
  return { connection, checkConnection }
}
