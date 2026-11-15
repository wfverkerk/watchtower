import { describe, expect, it } from 'vitest'
import { getEventFlow } from './eventFlow'

describe('event flows', () => {
  it('follows a made field goal from scorer to assist to shot location', () => {
    expect(getEventFlow({ type: 'score', value: 2 })).toEqual(['player', 'assist', 'location'])
    expect(getEventFlow({ type: 'score', value: 1 })).toEqual(['player'])
  })

  it('asks who got the rebound after every missed shot, before the location of a field goal attempt', () => {
    expect(getEventFlow({ type: 'missed_shot', value: 3 })).toEqual(['player', 'rebound', 'location'])
    expect(getEventFlow({ type: 'missed_shot', value: 1 })).toEqual(['player', 'rebound'])
  })
})
