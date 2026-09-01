-- Greenscape AI Ops: core schema
-- All access goes through Netlify Functions using the service role key.
-- RLS is enabled with no policies => anon/public access denied by default.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  address text,
  source text not null default 'manual' check (source in ('meta','google_lsa','referral','manual')),
  project_type text,
  budget_range text,
  status text not null default 'new' check (status in ('new','qualified','site_walk_done','proposal_sent','won','lost')),
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table public.pricing_catalog (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  category text not null,
  item_name text not null,
  unit text not null check (unit in ('sqft','lnft','each','hour','day','project')),
  unit_price numeric(10,2) not null,
  min_price numeric(10,2) not null,
  max_price numeric(10,2) not null,
  notes text
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','needs_clarification','pending_review','approved','sent','viewed','accepted','declined')),
  site_walk_notes text,
  scope_summary text,
  client_note text,
  clarification_reason text,
  subtotal numeric(12,2),
  total numeric(12,2),
  deposit_amount numeric(12,2),
  client_token uuid not null default gen_random_uuid(),
  ai_model text,
  input_tokens integer,
  output_tokens integer,
  generation_cost_usd numeric(10,5),
  ai_warnings jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz
);
create index proposals_lead_id_idx on public.proposals(lead_id);
create unique index proposals_client_token_idx on public.proposals(client_token);

create table public.proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  catalog_item_id uuid references public.pricing_catalog(id),
  description text not null,
  qty numeric(10,2) not null default 1,
  unit text,
  unit_price numeric(10,2) not null,
  line_total numeric(12,2) not null,
  confidence numeric(3,2),
  needs_review boolean not null default false,
  review_reason text,
  sort_order integer not null default 0
);
create index proposal_line_items_proposal_id_idx on public.proposal_line_items(proposal_id);

-- Stretch module: closed-lost reactivation
create table public.closed_lost_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  project_type text,
  quoted_amount numeric(12,2),
  lost_reason text,
  last_contact_date date,
  ghl_notes text,
  status text not null default 'untouched' check (status in ('untouched','draft_ready','approved','sent','responded','reactivated','opted_out')),
  created_at timestamptz not null default now()
);

create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  closed_lost_lead_id uuid not null references public.closed_lost_leads(id) on delete cascade,
  channel text not null default 'sms' check (channel in ('sms','email')),
  message text not null,
  status text not null default 'pending_review' check (status in ('pending_review','approved','sent','rejected')),
  ai_model text,
  generation_cost_usd numeric(10,5),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outreach_drafts_lead_idx on public.outreach_drafts(closed_lost_lead_id);

-- Audit log
create table public.events (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index events_entity_idx on public.events(entity_type, entity_id);

-- Lock everything down: service role bypasses RLS, anon gets nothing.
alter table public.leads enable row level security;
alter table public.pricing_catalog enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_line_items enable row level security;
alter table public.closed_lost_leads enable row level security;
alter table public.outreach_drafts enable row level security;
alter table public.events enable row level security;