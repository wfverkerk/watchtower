import type { Team } from '../domain/game'

export const teamColorPalette = ['#f26a36', '#5d72d9', '#2fa37a', '#e0457b', '#f2b636', '#8e5cd9', '#2a9bb8', '#242323']
export const zoebasColor = '#f26a36'
export const zoebasSecondColor = '#b8431c'

const storageKey = 'watchtower-team-colors-v1'

function readColors(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && teamColorPalette.includes(entry[1])))
  } catch (reason) {
    console.error('Failed to read team colors.', reason)
    return {}
  }
}

function colorKey(teamName: string) {
  return teamName.trim().toLocaleLowerCase()
}

export function savedTeamColor(teamName: string) {
  return readColors()[colorKey(teamName)]
}

export function rememberTeamColor(teamName: string, color: string) {
  if (!teamColorPalette.includes(color) || !colorKey(teamName)) return
  window.localStorage.setItem(storageKey, JSON.stringify({ ...readColors(), [colorKey(teamName)]: color }))
}

export function isZoebasName(value: string | null | undefined) {
  return /zoebas/i.test(value ?? '')
}

// Zoebas teams keep their orange; two Zoebas teams in one game get two different oranges.
export function withStartingColors(home: Omit<Team, 'color'>, away: Omit<Team, 'color'>): [Team, Team] {
  const homeColor = home.zoebas ? zoebasColor : savedTeamColor(home.name) ?? '#f26a36'
  const awayColor = away.zoebas ? (home.zoebas ? zoebasSecondColor : zoebasColor) : savedTeamColor(away.name) ?? '#5d72d9'
  return [{ ...home, color: homeColor }, { ...away, color: awayColor }]
}
