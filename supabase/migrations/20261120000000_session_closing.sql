-- Closing now always passes through the 10-minute closed window, including automatic closing
-- (3 hours after the start, or 30 minutes without counted events). Replaces session_status from 20261119.
create or replace function public.session_status(p_match_id uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.shared_matches%rowtype;
  v_last timestamptz;
  v_auto_close timestamptz;
  v_closing timestamptz;
begin
  select * into v from public.shared_matches where id = p_match_id;
  if not found or v.session_starts_at is null then return null; end if;
  if v.review_status = 'final' then return 'final'; end if;

  select max(received_at) into v_last from public.match_events
    where match_id = p_match_id and counts_as_activity;
  v_auto_close := least(
    v.session_starts_at + interval '180 minutes',
    greatest(v.session_starts_at, coalesce(v_last, v.session_starts_at)) + interval '30 minutes'
  );
  v_closing := least(coalesce(v.session_close_requested_at, v.session_closed_at), v_auto_close);

  if now() >= v_closing + interval '10 minutes' then return 'in_review'; end if;
  if now() >= v_closing then return 'closed'; end if;
  if now() < v.session_starts_at then return 'open'; end if;
  return 'live';
end;
$$;
