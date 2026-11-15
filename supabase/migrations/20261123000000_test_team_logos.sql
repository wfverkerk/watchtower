-- Logos for the test games. The image files live in supabase/test-logos/ and must be uploaded
-- to the public "logos" bucket with the same file names.
insert into public.opponent_teams (name, logo_file)
values
  ('HARLEM GLOBETROTTERS', 'HARLEM GLOBETROTTERS.png'),
  ('WASHINGTON GENERALS', 'WASHINGTON GENERALS.png')
on conflict do nothing;
