-- Pipeline Q&A agent: questions asked from Slack (slash command) or the
-- admin dashboard, answered asynchronously by a Claude tool-use loop.
create table public.assistant_queries (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text,
  status text not null default 'running' check (status in ('running','answered','failed')),
  source text not null default 'admin' check (source in ('admin','slack')),
  asked_by text,
  response_url text,
  ai_model text,
  input_tokens integer,
  output_tokens integer,
  generation_cost_usd numeric(8,5),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

alter table public.assistant_queries enable row level security;
