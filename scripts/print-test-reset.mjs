import { readFileSync } from 'node:fs'

function migrationSection(file, marker) {
  const contents = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
  const start = contents.indexOf(marker)
  if (start === -1) throw new Error(`Missing expected seed statement in ${file}`)
  return contents.slice(start).trim()
}

const catalog = migrationSection(
  '20261111000000_zoebas_team_catalog.sql',
  'insert into public.zoebas_teams ',
)
const staff = migrationSection(
  '20261111000200_zoebas_team_staff_roles.sql',
  'update public.zoebas_teams as teams',
)

process.stdout.write(`-- One-time destructive reset of Watchtower test data.
-- Run the entire script in one Supabase SQL Editor query.
begin;

delete from public.match_events;
delete from public.shared_match_members;
delete from public.shared_matches;
delete from public.zoebas_teams;

${catalog}

${staff}

commit;

analyze public.match_events;
analyze public.shared_match_members;
analyze public.shared_matches;
analyze public.zoebas_teams;
`)
