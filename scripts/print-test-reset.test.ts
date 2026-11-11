import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('test database reset script', () => {
  it('wraps the explicit deletes and existing seeds in one transaction', () => {
    const sql = execFileSync(process.execPath, ['scripts/print-test-reset.mjs'], { encoding: 'utf8' })
    const begin = sql.indexOf('begin;')
    const commit = sql.indexOf('commit;')
    const tables = ['match_events', 'shared_match_members', 'shared_matches', 'zoebas_teams']

    expect(begin).toBeGreaterThanOrEqual(0)
    expect(commit).toBeGreaterThan(begin)
    for (const table of tables) {
      const deletion = sql.indexOf(`delete from public.${table};`)
      expect(deletion).toBeGreaterThan(begin)
      expect(deletion).toBeLessThan(commit)
      expect(sql.indexOf(`analyze public.${table};`)).toBeGreaterThan(commit)
    }
    expect(sql.indexOf('insert into public.zoebas_teams ')).toBeGreaterThan(begin)
    expect(sql.indexOf('update public.zoebas_teams as teams')).toBeLessThan(commit)
    expect(sql).not.toMatch(/\btruncate\b/i)
  })
})
