import { readFileSync } from 'node:fs'

// The Zoebas team catalog is seeded by the baseline migration.
const baseline = readFileSync(new URL('../supabase/migrations/20261206000000_baseline.sql', import.meta.url), 'utf8')
const start = baseline.indexOf('insert into public.zoebas_teams ')
if (start === -1) throw new Error('Missing the Zoebas team catalog seed in the baseline migration')
const catalog = baseline.slice(start, baseline.indexOf(';\n', start) + 2).trim()

process.stdout.write(`-- One-time destructive reset of Watchtower test data.
-- Run the entire script in one Supabase SQL Editor query.
begin;

delete from public.match_events;
delete from public.shared_match_members;
delete from public.shared_matches;
delete from public.zoebas_teams;

${catalog}

commit;

analyze public.match_events;
analyze public.shared_match_members;
analyze public.shared_matches;
analyze public.zoebas_teams;
`)
