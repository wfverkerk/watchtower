import { describe, expect, it } from 'vitest'
import { findOpponentTeam, loadCachedOpponentTeams, opponentTeamsStorageKey, parseOpponentTeams, suggestOpponentTeams } from './opponentTeams'

const teams = parseOpponentTeams([
  { id: '1', name: 'Zoebas Mse 1', logo_file: 'ZOEBAS MSE 1.png' },
  { id: '2', name: 'Apollo Amsterdam', logo_file: null },
  { id: '3', name: 'Rap Élan', logo_file: 'RAP ELAN.webp' },
  { id: '4', name: 'Bc Apollo', logo_file: 'BC APOLLO.jpg' },
])

describe('opponent teams', () => {
  it('suggests prefix and word-prefix matches before other matches, ignoring case and diacritics', () => {
    expect(suggestOpponentTeams(teams, 'apo').map((team) => team.name)).toEqual(['Apollo Amsterdam', 'Bc Apollo'])
    expect(suggestOpponentTeams(teams, 'ELAN').map((team) => team.name)).toEqual(['Rap Élan'])
    expect(suggestOpponentTeams(teams, 'lo ams').map((team) => team.name)).toEqual(['Apollo Amsterdam'])
    expect(suggestOpponentTeams(teams, 'sse')).toEqual([])
    expect(suggestOpponentTeams(teams, '  ')).toEqual([])
    expect(suggestOpponentTeams(teams, 'a', 2)).toHaveLength(2)
  })

  it('finds an exact team regardless of case and surrounding spaces', () => {
    expect(findOpponentTeam(teams, '  ZOEBAS   mse 1 ')?.id).toBe('1')
    expect(findOpponentTeam(teams, 'Zoebas')).toBeNull()
  })

  it('rejects malformed rows and ignores a corrupt cache', () => {
    expect(() => parseOpponentTeams([{ id: 1, name: 'x' }])).toThrow('invalid data')
    expect(loadCachedOpponentTeams({ getItem: () => '{broken' })).toEqual([])
    expect(loadCachedOpponentTeams({ getItem: (key) => key === opponentTeamsStorageKey ? JSON.stringify([{ id: '1', name: 'A', logo_file: null }]) : null })).toHaveLength(1)
  })
})
