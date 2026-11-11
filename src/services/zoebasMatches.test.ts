import { describe, expect, it } from 'vitest'
import { getRecommendedMatch, parseZoebasMatches } from './zoebasMatches'

const now = new Date('2026-11-11T18:00:00')

describe('Zoebas match schedule', () => {
  it('parses scheduled and completed match data', () => {
    expect(parseZoebasMatches({
      totalCount: 1,
      items: [{
        id: 42,
        date: '2026-11-11T00:00:00',
        startTime: '18:10:00',
        homeTeamName: 'Zoebas X12-1',
        awayTeamName: 'Opponent X12-1',
        homeScore: 0,
        awayScore: null,
        status: 'Scheduled',
        accommodationName: 'Sporthal',
      }],
    })).toEqual([{
      id: '42',
      date: '2026-11-11',
      startTime: '18:10',
      homeTeamName: 'Zoebas X12-1',
      awayTeamName: 'Opponent X12-1',
      homeScore: 0,
      awayScore: null,
      status: 'Scheduled',
      venue: 'Sporthal',
    }])
  })

  it('recommends the nearest match starting now or within the previous fifteen minutes', () => {
    const matches = parseZoebasMatches({
      items: [
        { id: 'soon', date: '2026-11-11', startTime: '18:14', homeTeamName: 'Home', awayTeamName: 'Soon' },
        { id: 'recent', date: '2026-11-11', startTime: '17:58', homeTeamName: 'Home', awayTeamName: 'Recent' },
        { id: 'old', date: '2026-11-11', startTime: '17:40', homeTeamName: 'Home', awayTeamName: 'Old' },
      ],
    })
    expect(getRecommendedMatch(matches, now)?.id).toBe('recent')
  })

  it('does not recommend a cancelled or distant match', () => {
    const matches = parseZoebasMatches({
      items: [
        { id: 'cancelled', date: '2026-11-11', startTime: '18:01', homeTeamName: 'Home', awayTeamName: 'Cancelled', status: 'Cancelled' },
        { id: 'distant', date: '2026-11-11', startTime: '18:20', homeTeamName: 'Home', awayTeamName: 'Distant' },
      ],
    })
    expect(getRecommendedMatch(matches, now)).toBeNull()
  })
})
