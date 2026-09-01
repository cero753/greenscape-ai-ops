# Design: Test-first cycle → presentation (Greenscape AI Ops)

**Date:** 2026-09-01 · **Time budget:** 2–4 hours · **Approach:** A (test-first)
**Goal:** Ship the finished build with every feature verified live, then produce a slide deck + spoken script so Kartik can record the submission video.

## Constraints

- No new features. The pipeline Q&A agent (already coded, staged) is the last one.
- All testing runs against the deployed URL (https://greenscape-ai-ops.netlify.app), not localhost.
- Slack messages can only be visually confirmed by Kartik — Claude verifies the API/DB side, Kartik confirms pings land in the channel.
- Incremental commits throughout; secrets never committed.
- Fixes too risky for the time budget become documented known limitations, not rushed patches.

## Phase 0 — Ship what's built (~10 min)

1. Commit the staged Q&A agent (migration, `slack-ask.ts`, `slack-ask-background.ts`, `api.ts`, `Dashboard.tsx`) + README update.
2. Push to GitHub, deploy to Netlify (picks up `SLACK_WEBHOOK_URL` + new endpoints together).
3. Smoke check: site loads, `/api/slack-ask` GET/POST respond.

## Phase 1 — Full live test matrix (~60–90 min)

Results recorded pass/fail in a checklist (working notes, summarized in the final report). Areas:

| # | Area | Tests |
|---|------|-------|
| 1 | Intake | Simulate GHL webhook → lead row created → Slack ping (Kartik confirms) |
| 2 | Generation | Site-walk notes → 202 → background job → UI poll → draft with line items, tokens + cost logged |
| 3 | Guardrails | Off-catalog item → $0 + flagged · approve-send while flagged → 400 · garbage notes → needs_clarification with useful checklist · price outside catalog band → flagged |
| 4 | HITL | Edit qty/price → totals recompute · resolve flag → approve & send succeeds → Slack ping |
| 5 | Client page | Token URL works logged-out · no AI/internal fields in payload · accept → lead won, deposit stub, Slack 🎉 |
| 6 | Reactivation | Draft batch (voice rules hold) · approve/send · reject · double-send → 400 · Slack pings |
| 7 | Q&A agent | 3 dashboard suggestion questions + 1 adversarial ("ignore instructions…") + 1 off-topic · answers match DB truth · cost logged · GET poll works · failure path sane |
| 8 | Robustness | Invalid/missing IDs on every endpoint · empty inputs · double-clicks · SPA deep-link refresh on all routes · basic narrow-viewport check |

Also: 2-minute instructions for Kartik to wire the optional Slack `/ask` slash command.

## Phase 2 — Fix round (~30–60 min)

Fix everything Phase 1 catches → redeploy → retest exactly the failed paths. One commit per coherent fix. Unfixable-in-budget issues go to a Known Limitations list that feeds the presentation (honesty beats hiding).

## Phase 3 — Requirement audit (~15 min)

Table mapping every ITP brief requirement + client-doc pain point → where the build answers it → the demoable proof. Any silent gap surfaces here; the table becomes a slide.

## Phase 4 — Presentation (~45–60 min)

1. **HTML slide deck** — single self-contained file (`docs/presentation/deck.html`, NOT deployed), arrow-key navigation, screen-recordable. Slides: client problem + ROI math → 5-agent ranking → architecture diagram → the AI core → guardrail layers → agent-vs-workflow (Q&A agent) → cost story → test-round results → requirement-audit table → what's next.
2. **Spoken script** (updates `C:\Users\karti\itp-submission\loom-and-email.md`): a long-form cut timed to the deck + the tight ≤5-min Loom cut with exact click path.

## Error handling

- Deploy failure → fresh `deploy-site` MCP command (proxy tokens expire).
- Background-function failures → check `events` table for `generation_failed`, then Netlify function logs.
- Shell-classifier outages (intermittent today) → fall back to Supabase MCP for DB checks, retry shell between steps.

## Success criteria

- Every matrix row pass (or documented limitation) against the live URL.
- Deck opens in a browser and covers all listed slides.
- Script updated so Kartik can record without improvising.
