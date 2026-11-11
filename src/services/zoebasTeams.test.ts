import { describe, expect, it } from 'vitest'
import { parseZoebasTeams } from './zoebasTeams'

describe('Zoebas team catalog', () => {
  it('parses team names, player names, and staff names from Supabase rows', () => {
    expect(parseZoebasTeams([
      {
        id: 'x12-1',
        name: 'X12-1',
        source_team_id: 'team-guid',
        player_names: [' Marley ', 'Stef'],
        coach_names: [' Willem '],
        coach_roles: ['Coach'],
      },
    ])).toEqual([
      {
        id: 'x12-1',
        name: 'X12-1',
        sourceTeamId: 'team-guid',
        playerNames: ['Marley', 'Stef'],
        staff: [{ name: 'Willem', role: 'coach' }],
      },
    ])
  })

  it('distinguishes assistant coaches and defaults old catalog rows to coach', () => {
    expect(parseZoebasTeams([
      {
        id: 'mse-3',
        name: 'MSE-3',
        source_team_id: 'team-guid',
        player_names: [],
        coach_names: ['Ezra', 'Richard'],
        coach_roles: ['Coach', 'Assistent coach'],
      },
      { id: 'x12-1', name: 'X12-1', source_team_id: 'team-guid-2', player_names: [], coach_names: ['Willem'] },
    ]).map((team) => team.staff)).toEqual([
      [{ name: 'Ezra', role: 'coach' }, { name: 'Richard', role: 'assistant' }],
      [{ name: 'Willem', role: 'coach' }],
    ])
  })

  it('rejects malformed, empty, or duplicate catalog data', () => {
    expect(() => parseZoebasTeams([{ id: 'bad' }])).toThrow('invalid data')
    expect(() => parseZoebasTeams([])).toThrow('empty')
    expect(() => parseZoebasTeams([
      { id: 'x12-1', name: 'X12-1', source_team_id: 'team-guid', player_names: [] },
      { id: 'x12-1', name: 'X12-1', source_team_id: 'team-guid', player_names: [] },
    ])).toThrow('duplicate IDs')
  })
})
