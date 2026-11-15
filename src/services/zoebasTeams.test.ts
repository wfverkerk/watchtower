import { describe, expect, it } from 'vitest'
import { parseZoebasTeams } from './zoebasTeams'

describe('Zoebas team catalog', () => {
  it('parses team names and player names from Supabase rows', () => {
    expect(parseZoebasTeams([
      {
        id: 'x12-1',
        name: 'X12-1',
        source_team_id: 'team-guid',
        player_names: [' Marley ', 'Stef'],
      },
    ])).toEqual([
      {
        id: 'x12-1',
        name: 'X12-1',
        sourceTeamId: 'team-guid',
        playerNames: ['Marley', 'Stef'],
      },
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
