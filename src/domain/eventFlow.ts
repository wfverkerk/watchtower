import type { StatType } from './game'

export type EventFlowStep = 'player' | 'assist' | 'rebound' | 'location' | 'foulType' | 'turnoverType'

// A flow is the sequence of questions that naturally follows one event, e.g. who scored, who assisted, then where the shot was taken.
export function getEventFlow(action: { type: StatType; value: number }, expertMode = true): EventFlowStep[] {
  if (!expertMode) return ['player']
  switch (action.type) {
    case 'score': return action.value > 1 ? ['player', 'assist', 'location'] : ['player']
    case 'missed_shot': return action.value > 1 ? ['player', 'rebound', 'location'] : ['player', 'rebound']
    case 'foul': return ['player', 'foulType']
    case 'turnover': return ['player', 'turnoverType']
    default: return ['player']
  }
}
