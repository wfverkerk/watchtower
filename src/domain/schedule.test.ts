import { describe, expect, it } from 'vitest'
import { groupByDay, groupTeams, scheduleBucket, winnerSide, type ScheduleGame } from './schedule'

const base: ScheduleGame = {
  id: '1',
  kind: 'program',
  date: '2026-11-15',
  startTime: '12:00',
  homeTeam: 'MSE-1',
  awayTeam: 'VSE-1',
  homeScore: null,
  awayScore: null,
  status: '',
  venue: '',
}
const now = new Date(2026, 10, 15, 12, 30).getTime()

describe('schedule buckets', () => {
  it('shows a game of today as open until three hours after its start', () => {
    expect(scheduleBucket(base, now)).toBe('open')
    expect(scheduleBucket(base, new Date(2026, 10, 15, 15, 0).getTime())).toBe('history')
  })

  it('puts later days in upcoming and earlier days or results in history', () => {
    expect(scheduleBucket({ ...base, date: '2026-11-16' }, now)).toBe('upcoming')
    expect(scheduleBucket({ ...base, date: '2026-11-14' }, now)).toBe('history')
    expect(scheduleBucket({ ...base, kind: 'result' }, now)).toBe('history')
  })
})

describe('favorite team sections', () => {
  it('groups teams by age group, keeps other codes together and puts test teams in their own section', () => {
    const sections = groupTeams(['V22-1', 'M12-1', 'M16-2', 'MSE-2', 'U14-1', 'Harlem Globetrotters'], new Set(['Harlem Globetrotters']))
    expect(sections.map((section) => [section.group, section.teams])).toEqual([
      ['young', ['M12-1']],
      ['middle', ['U14-1', 'M16-2']],
      ['other', ['MSE-2', 'V22-1']],
      ['test', ['Harlem Globetrotters']],
    ])
  })
})

describe('schedule grouping', () => {
  it('groups games per day in order', () => {
    const grouped = groupByDay([base, { ...base, id: '3', date: '2026-11-16' }, { ...base, id: '4' }])
    expect(grouped.map((group) => [group.date, group.games.map((game) => game.id)])).toEqual([
      ['2026-11-15', ['1', '4']],
      ['2026-11-16', ['3']],
    ])
  })

  it('reports the winner from the score and no winner for a draw or missing score', () => {
    expect(winnerSide({ ...base, homeScore: 60, awayScore: 58 })).toBe('home')
    expect(winnerSide({ ...base, homeScore: 50, awayScore: 58 })).toBe('away')
    expect(winnerSide({ ...base, homeScore: 50, awayScore: 50 })).toBeNull()
    expect(winnerSide(base)).toBeNull()
  })
})
