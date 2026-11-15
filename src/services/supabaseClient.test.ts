// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialGameState } from '../domain/game'
import { saveMatchLink } from './matchEventLog'
import { queueMatchSnapshot } from './matchSnapshots'
import { isAuthCallbackBlocked } from './supabaseClient'

afterEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('coach sign-in callback', () => {
  it('does not switch identities while a shared match or pending snapshots exist', () => {
    window.history.replaceState(null, '', '/#access_token=example')
    expect(isAuthCallbackBlocked()).toBe(false)
    saveMatchLink({ matchId: 'match', trackerId: 'tracker', joinCode: 'CODE', displayName: 'Scorer' })
    expect(isAuthCallbackBlocked()).toBe(true)
    saveMatchLink(null)
    queueMatchSnapshot('old', 'tracker', createInitialGameState())
    expect(isAuthCallbackBlocked()).toBe(true)
  })

  it('blocks account changes if pending snapshot storage cannot be read', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState(null, '', '/?code=example')
    window.localStorage.setItem('watchtower-match-snapshots-v1', '{invalid')
    expect(isAuthCallbackBlocked()).toBe(true)
  })
})
