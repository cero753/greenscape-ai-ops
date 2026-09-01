-- The reactivation generator runs as a Netlify background function, so the UI
-- needs an in-flight state to poll against (and to prevent double-drafting).
alter table public.closed_lost_leads
  drop constraint closed_lost_leads_status_check;

alter table public.closed_lost_leads
  add constraint closed_lost_leads_status_check
  check (status in ('untouched','drafting','draft_ready','approved','sent','responded','reactivated','opted_out'));
