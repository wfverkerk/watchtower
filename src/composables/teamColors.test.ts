// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { rememberTeamColor, savedTeamColor, teamColorPalette, withStartingColors, zoebasColor, zoebasSecondColor } from './teamColors'

beforeEach(() => window.localStorage.clear())

describe('team colors', () => {
  it('remembers a palette color per team name, ignoring case and surrounding spaces', () => {
    rememberTeamColor(' X12-1 ', teamColorPalette[2])
    expect(savedTeamColor('x12-1')).toBe(teamColorPalette[2])
    expect(savedTeamColor('X12-2')).toBeUndefined()
  })

  it('rejects colors outside the palette', () => {
    rememberTeamColor('X12-1', '#123456')
    expect(savedTeamColor('X12-1')).toBeUndefined()
  })

  it('keeps Zoebas teams orange and uses a second orange when two Zoebas teams play', () => {
    rememberTeamColor('M16-1', teamColorPalette[2])
    const [home, away] = withStartingColors({ id: 'home', name: 'X12-1', zoebas: true }, { id: 'away', name: 'M16-1', zoebas: false })
    expect([home.color, away.color]).toEqual([zoebasColor, teamColorPalette[2]])
    const [, zoebasAway] = withStartingColors({ id: 'home', name: 'X12-1', zoebas: true }, { id: 'away', name: 'X12-2', zoebas: true })
    expect(zoebasAway.color).toBe(zoebasSecondColor)
  })
})
