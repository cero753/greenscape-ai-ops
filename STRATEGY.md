# AI Agent Strategy — Greenscape Pro

**Prepared for:** Marcus Tate, Greenscape Pro (Phoenix, AZ · $4.2M design-build)
**Thesis:** Greenscape Pro is not lead-constrained, staff-constrained, or quality-constrained. It is **Marcus-constrained**. Every dollar of AI spend should buy back the hours where Marcus is the single point of failure — starting with the one place his bottleneck directly torches revenue: the quote cycle.

---

## The ranking

### 1. AI Proposal Engine — site-walk notes → priced, reviewable proposal in minutes ✅ *built*

The 6–9 day quote cycle is losing 35–40% of *qualified* leads — people Marcus already walked the property with — to competitors who simply answered faster. At a $28K average ticket and ~150 projects/yr, even the conservative read is brutal: if roughly 90–100 qualified prospects a year walk away over speed and we recover just a third of them with same-48-hours proposals, that's **~$500–700K/yr in recovered revenue**. Nothing else on this list is within an order of magnitude.

The bottleneck is specific and automatable: only Marcus can turn site-walk notes into scoped line items, and the pricing already lives in a 200+ line-item spreadsheet. That's not judgment work — it's retrieval + mapping with judgment *at the end*. So the agent drafts (constrained to the real pricing catalog), and Marcus approves in five minutes instead of composing for five evenings. He stays the pricing authority; he stops being the pricing typist.

### 2. Post-Sign Pipeline Chaser — get signed projects to groundbreaking

8–12 signed projects sit in permit/HOA/deposit limbo at any time — **$224–336K in revenue perpetually delayed**, and it's Jenna chasing paperwork by memory. An agent that tracks each project's blocking item (HOA approval, permit, deposit, material lead time), nags the right party on a cadence via GHL, and escalates stalls to Slack converts signed contracts into invoiceable work faster. Low AI complexity, high dollar-velocity impact — it's #2 only because #1's dollars are bigger.

### 3. Closed-Lost Reactivation — mine the 1,400-lead graveyard

1,400 closed-lost leads in GHL. Industry re-close rates of ~2% on personal, non-spammy reactivation puts **~$784K of latent pipeline** in that list. The agent drafts Marcus-voiced, context-aware messages ("you were looking at travertine around the pool last spring — material prices finally came down") in small weekly batches he approves. Ranked #3 because it's net-new revenue *only if* #1 exists — reactivating leads into a 9-day quote cycle just re-loses them.

### 4. Build-Update Agent — proactive client updates from CompanyCam/Jobber

Loom updates go out on ~30% of jobs; the other 70% of clients call, and those calls interrupt the field. Trigger on CompanyCam photo uploads + Jobber status changes, draft a Marcus-voice update, one-tap approve. This is a referral engine in disguise for a premium brand — but it protects sentiment rather than recovering hard dollars, so it waits.

### 5. Lead Pre-Qualification Agent — protect the calendar

4–6 unqualified calls a week burn Marcus's scarcest asset. An SMS/web qualifier (budget floor, timeline, service area, project type) in front of his calendar saves 1–2 hrs/wk. Real but small; it also gets *more* valuable after #3 refills the funnel. Last on purpose.

---

## Why this ordering (and not the founder's)

**Is my #1 the founder's #1?** Effectively yes — Marcus named quoting as his worst pain, and the discovery audit called quote-cycle compression "the single highest-leverage intervention." But I'd have ranked it #1 even if he hadn't: it's the only item where a stopwatch (6–9 days → 48 hours) converts directly into found revenue at the highest ticket size. The rest of his list I deliberately did *not* defer to — his interest in crew coaching and more marketing doesn't survive contact with his own numbers, and an AI partner who just re-orders the founder's wishlist is a vendor, not an advisor.

**What I considered and excluded: the Crew Coaching / Training Agent.** It looks attractive — $104K/yr in rework and callbacks is a real number, and "AI trains my crew" demos well. But it fails three tests. (1) *Relative size:* ~$2K/wk of leakage vs. $16K+/wk at risk in the quote gap — an order of magnitude apart. (2) *Mechanism:* rework is a process/supervision problem; an LLM sending crews training content has the weakest causal path to fixing it of anything on this list. (3) *Opportunity cost:* it consumes the same build-and-adoption budget as the Proposal Engine while touching none of the revenue engine. Same logic kills a marketing/content agent: at 4.5x ROAS the funnel isn't the problem — Marcus is quote-constrained, not lead-constrained. More leads into a 9-day quote cycle is buying water for a bucket with a hole in it.

---
*The #1 agent is built and live — deployed URL, repo, and architecture notes in the README. Guardrails: catalog-constrained pricing, out-of-band price flagging, garbage-input refusal, and nothing reaches a client without Marcus's approval.*
