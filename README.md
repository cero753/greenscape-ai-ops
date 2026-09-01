# Greenscape AI Ops — AI Proposal Engine

Turns Marcus's raw site-walk notes into a priced, client-ready proposal in ~30 seconds — constrained to the company's real pricing catalog, flagged where the AI is unsure, and **never sent without human approval**. Built as the #1 agent from [STRATEGY.md](./STRATEGY.md).

**Live demo:** _deployed URL in the Netlify section below_
**Stack:** React + Vite + Tailwind v4 · Netlify Functions (TypeScript) · Supabase Postgres · Claude API (`claude-sonnet-4-6`) · Slack incoming webhook

---

## The flow

```
Meta form / GHL  ──►  POST /api/ghl-webhook          (simulated intake, Slack ping)
                          │
Marcus does site walk ──► pastes notes in lead page
                          │
                 POST /api/generate-proposal
                          │  Claude maps notes → catalog line items (structured output)
                          │  server re-validates codes + price bands
                          ▼
                 Proposal: pending_review  ──►  HITL review UI (edit / confirm flags)
                          │  approve & send (blocked while items are flagged)
                          ▼
                 Client page  /p/<token>   ──►  viewed → accepted
                          │                          │
                       Slack 👀                  Slack 🎉 + 50% deposit stub
```

Every state change lands in an `events` audit table.

## Guardrails ("what happens if the model returns garbage?")

1. **Catalog-constrained pricing** — the model may only price against real catalog codes; free-form items come back at $0 and flagged for manual pricing.
2. **Structured output** — zod-validated via the SDK's `messages.parse()`; the model cannot return prose. One retry on invalid output, then a clean failure.
3. **Server-side re-validation** — unknown codes are zeroed and flagged; unit prices outside the catalog's min/max band are flagged. The model's numbers are never trusted blind.
4. **Garbage-input refusal** — nonsense/insufficient notes produce a `needs_clarification` proposal stating what's missing, not a fabricated quote. (Try the "Garbage input" preset on any lead.)
5. **Human-in-the-loop, enforced twice** — the UI blocks Approve & Send while any line is flagged, and the API independently rejects sends with unresolved flags. Nothing reaches a client unapproved.
6. **Public page isolation** — the client page is keyed by an unguessable UUID token and exposes only client-safe fields (no AI metadata, internal notes, or costs). All DB access goes through serverless functions with the service-role key; RLS is enabled with zero anon policies.

## Cost

`claude-sonnet-4-6` at $3/M input, $15/M output. A typical generation is ~4–5K input (catalog + notes) + ~1K output ≈ **$0.03/proposal** — tokens and dollar cost are logged per proposal and shown in the review UI. At 300 proposals/yr that's under $10/yr of inference against ~$500K+/yr of recovered revenue. Sonnet over Opus is deliberate: the task is constrained extraction + mapping with server-side validation and human review behind it, so top-shelf reasoning buys nothing here; Haiku was rejected because scope interpretation from messy field notes is exactly where the cheaper tier starts hallucinating quantities.

## Repo tour

```
STRATEGY.md              ← deliverable 1: the 5-agent ranking
netlify/functions/
  ghl-webhook.ts         ← simulated GHL/Zapier lead intake
  generate-proposal.ts   ← the AI core: Claude + guardrails + cost logging
  proposal.ts            ← HITL: detail / edit / approve-send
  client-proposal.ts     ← public token-scoped view + accept
  leads.ts, catalog.ts   ← reads for the dashboard
  _lib/                  ← supabase client, event logger, slack, http helpers
supabase/migrations/     ← schema + seed (63-item Phoenix pricing catalog, demo leads)
src/pages/               ← Dashboard, LeadDetail, ProposalReview (admin, dark)
                           ClientProposal (public, print-style paper)
```

## Run it locally

```bash
npm install
cp .env.example .env        # fill in values (see .env.example for docs)
npx netlify dev             # serves the app + functions on :8888
```

Supabase: create a project, run the two files in `supabase/migrations/` in order (SQL editor or `supabase db push`).

Environment variables (documented in [.env.example](./.env.example)): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `SLACK_WEBHOOK_URL` (optional — notifications degrade gracefully), `PUBLIC_BASE_URL`.

## Assumptions & simplifications

- **GHL intake is simulated** by `/api/ghl-webhook` (same payload shape a Zapier→GHL hook would deliver); production would point Zapier at this endpoint and push status changes back to GHL via its API.
- **"Send" = Slack + shareable link**; production would deliver via GHL email/SMS from Marcus's domain.
- **Deposit invoice is a stub** (Slack notification of the 50% amount); production would create a Stripe invoice.
- The pricing catalog is a realistic 63-item Phoenix hardscape set distilled from the 200+ line-item spreadsheet described in discovery.
- Admin auth is omitted for demo access; production gets Supabase Auth on the admin routes (the public client page already has token-scoped isolation).

## What I'd build next

1. **Reactivation module** (strategy #3) — batch Marcus-voiced outreach over the 1,400 closed-lost leads, same HITL approval pattern.
2. GHL two-way sync (real webhook + write-backs) and proposal PDF export.
3. Quote-cycle analytics: time-from-lead-to-sent, view-to-accept conversion — proving the 6–9 day → 48h claim with data.
