import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { getSupabase, logEvent } from './_lib/supabase'
import { json, badRequest, methodNotAllowed, parseBody, notFound, serverError, withErrors } from './_lib/http'
import { notifySlack, money } from './_lib/slack'

/**
 * POST /api/generate-proposal-background  { lead_id, site_walk_notes }
 *
 * The core AI step: turns Marcus's raw site-walk notes into a priced draft
 * proposal, constrained to the company pricing catalog.
 *
 * This is a Netlify BACKGROUND function (the `-background` suffix): the
 * platform replies 202 immediately and lets the function run up to 15 min,
 * because a 30-50s Claude generation cannot live inside a synchronous
 * function's ~10s limit. The admin UI polls the lead's proposals until the
 * draft lands (or a `generation_failed` event is logged).
 *
 * Guardrails (in order):
 *  1. Model may ONLY price against catalog codes it is given. Free-form items
 *     are allowed but always flagged `needs_review` with $0 until a human prices them.
 *  2. Structured output (zod schema) — the model cannot return prose.
 *  3. One retry on invalid/failed generation before giving up.
 *  4. Server-side re-validation: unknown codes and unit prices outside the
 *     catalog's min/max band are flagged `needs_review`, never silently trusted.
 *  5. Garbage/insufficient notes → proposal saved as `needs_clarification`
 *     with the model's reason, instead of a fabricated quote.
 *  6. Nothing goes to the client without human approval (status `pending_review`).
 *
 * Cost: claude-sonnet-4-6 @ $3/M input, $15/M output. A typical generation is
 * ~4-5K input + ~1K output tokens ≈ $0.03/proposal — logged per-proposal in
 * `generation_cost_usd` so unit economics are visible in the admin UI.
 */

const MODEL = 'claude-sonnet-4-6'
const INPUT_COST_PER_M = 3
const OUTPUT_COST_PER_M = 15

const LineItemSchema = z.object({
  catalog_code: z
    .string()
    .nullable()
    .describe('Exact code from the pricing catalog, or null if no catalog item fits'),
  description: z.string().describe('Client-facing line description'),
  qty: z.number().describe('Quantity in the catalog unit (sqft, lnft, each, hour, day, project)'),
  unit_price: z.number().describe('Unit price in USD, from the catalog'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('0-1: how confident you are this item + quantity matches the notes'),
  assumption: z
    .string()
    .nullable()
    .describe('Any assumption made (e.g. estimated area), or null'),
})

const ProposalSchema = z.object({
  sufficient_information: z
    .boolean()
    .describe('false if the notes are too vague, nonsensical, or missing measurements to price anything'),
  clarification_needed: z
    .string()
    .nullable()
    .describe('If insufficient: what specifically to ask the client/estimator. Otherwise null.'),
  scope_summary: z
    .string()
    .describe('2-4 sentence client-facing summary of the project scope'),
  line_items: z.array(LineItemSchema).describe('Priced line items. Empty if insufficient information.'),
})

interface GenerateBody {
  lead_id?: string
  site_walk_notes?: string
  /**
   * Autopilot (OFF by default): if the draft comes back with ZERO flagged
   * lines — every item matched a real catalog code, every price inside the
   * catalog band, no low-confidence lines — send it to the client
   * immediately, skipping the review queue. Any flag at all holds the draft
   * for human review exactly as before, and garbage notes still refuse.
   */
  autopilot?: boolean
}

interface CatalogItem {
  id: string
  code: string
  category: string
  item_name: string
  unit: string
  unit_price: number
  min_price: number | null
  max_price: number | null
  notes: string | null
}

function buildPrompt(catalog: CatalogItem[], lead: Record<string, unknown>, notes: string): string {
  const catalogLines = catalog
    .map(
      (c) =>
        `${c.code} | ${c.category} | ${c.item_name} | ${c.unit} | $${c.unit_price}/${c.unit}${c.notes ? ` | ${c.notes}` : ''}`,
    )
    .join('\n')

  return `You are the estimating assistant for Greenscape Pro, a premium hardscape and landscape design-build company in Phoenix, Arizona ($28K average project). You turn the owner's site-walk notes into a draft proposal.

PRICING CATALOG (code | category | item | unit | price | notes):
${catalogLines}

RULES:
- Price ONLY using catalog codes above. Set catalog_code to the exact code.
- If the notes mention work with no matching catalog item, include it with catalog_code=null, unit_price=0, confidence<=0.3 and explain in "assumption" — a human will price it.
- Use quantities from the notes. If you must estimate a quantity, state the assumption and lower your confidence.
- Do NOT invent measurements that materially change price. If key measurements are missing for the main scope, set sufficient_information=false instead.
- If the notes are nonsense, empty of project content, or not about a landscaping/hardscape project, set sufficient_information=false and explain what is needed in clarification_needed.
- Premium positioning: notes about demo/site prep, permits (drainage, gas lines for fire features), and access constraints matter — include prep/demo items when implied.

LEAD:
Name: ${lead.name}
Project type: ${lead.project_type ?? 'unknown'}
Stated budget: ${lead.budget_range ?? 'unknown'}
Address: ${lead.address ?? 'unknown'}

SITE-WALK NOTES:
${notes}`
}

export default withErrors(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return methodNotAllowed()

  const body = await parseBody<GenerateBody>(req)
  if (!body?.lead_id || !body?.site_walk_notes?.trim()) {
    return badRequest('lead_id and site_walk_notes are required')
  }

  const db = getSupabase()

  const [{ data: lead, error: leadError }, { data: catalog, error: catalogError }] =
    await Promise.all([
      db.from('leads').select('*').eq('id', body.lead_id).single(),
      db.from('pricing_catalog').select('*').order('category').order('code'),
    ])
  if (leadError || !lead) return notFound('Lead not found')
  if (catalogError || !catalog?.length) return serverError('Pricing catalog unavailable')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt = buildPrompt(catalog as CatalogItem[], lead, body.site_walk_notes)
  const outputFormat = zodOutputFormat(ProposalSchema)

  // Guardrail 3: one retry on invalid output / transient failure.
  let parsed: z.infer<typeof ProposalSchema> | null = null
  let inputTokens = 0
  let outputTokens = 0
  let lastError = ''
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: outputFormat },
      })
      inputTokens += response.usage.input_tokens
      outputTokens += response.usage.output_tokens
      parsed = response.parsed_output ?? null
      if (!parsed) lastError = 'Model returned no parseable output'
    } catch (err) {
      lastError = err instanceof Anthropic.APIError ? `${err.status}: ${err.message}` : String(err)
      console.error(`generate-proposal attempt ${attempt + 1} failed:`, lastError)
    }
  }

  const costUsd =
    (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000

  if (!parsed) {
    await logEvent('lead', body.lead_id, 'generation_failed', { error: lastError })
    return serverError(`AI generation failed after retry: ${lastError}`)
  }

  // Guardrail 5: garbage in -> clarification request out, never a garbage quote.
  if (!parsed.sufficient_information) {
    const { data: proposal, error } = await db
      .from('proposals')
      .insert({
        lead_id: body.lead_id,
        status: 'needs_clarification',
        site_walk_notes: body.site_walk_notes,
        scope_summary: parsed.scope_summary,
        clarification_reason: parsed.clarification_needed ?? 'Insufficient information in notes',
        subtotal: 0,
        total: 0,
        ai_model: MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        generation_cost_usd: costUsd,
        ai_warnings: [],
      })
      .select()
      .single()
    if (error) return serverError(error.message)

    await logEvent('proposal', proposal.id, 'needs_clarification', {
      reason: parsed.clarification_needed,
    })
    return json({ proposal, line_items: [] }, 201)
  }

  // Guardrails 1 + 4: server-side re-validation against the catalog.
  const byCode = new Map((catalog as CatalogItem[]).map((c) => [c.code, c]))
  const warnings: string[] = []

  const lineItems = parsed.line_items.map((item, i) => {
    const cat = item.catalog_code ? byCode.get(item.catalog_code) : undefined
    let needsReview = false
    let reviewReason: string | null = null
    let unitPrice = item.unit_price

    if (item.catalog_code && !cat) {
      // Model invented a code — hard flag, zero the price.
      needsReview = true
      reviewReason = `Unknown catalog code "${item.catalog_code}"`
      unitPrice = 0
      warnings.push(`Line ${i + 1}: ${reviewReason}`)
    } else if (cat) {
      const min = cat.min_price ?? cat.unit_price * 0.7
      const max = cat.max_price ?? cat.unit_price * 1.3
      if (unitPrice < min || unitPrice > max) {
        needsReview = true
        reviewReason = `Price $${unitPrice}/${cat.unit} outside catalog band $${min}–$${max}`
        warnings.push(`Line ${i + 1}: ${reviewReason}`)
      }
    } else {
      // Off-catalog item: allowed, but always human-priced.
      needsReview = true
      reviewReason = 'Not in pricing catalog — needs manual pricing'
      unitPrice = 0
      warnings.push(`Line ${i + 1}: off-catalog item "${item.description}"`)
    }

    if (!needsReview && item.confidence < 0.6) {
      needsReview = true
      reviewReason = `Low AI confidence (${Math.round(item.confidence * 100)}%)${item.assumption ? `: ${item.assumption}` : ''}`
    }

    return {
      catalog_item_id: cat?.id ?? null,
      description: item.description,
      qty: item.qty,
      unit: cat?.unit ?? 'each',
      unit_price: unitPrice,
      line_total: Math.round(item.qty * unitPrice * 100) / 100,
      confidence: item.confidence,
      needs_review: needsReview,
      review_reason: reviewReason,
      sort_order: i,
    }
  })

  const subtotal = lineItems.reduce((sum, li) => sum + li.line_total, 0)

  const { data: proposal, error: proposalError } = await db
    .from('proposals')
    .insert({
      lead_id: body.lead_id,
      status: 'pending_review', // Guardrail 6: HITL — nothing reaches the client unapproved.
      site_walk_notes: body.site_walk_notes,
      scope_summary: parsed.scope_summary,
      subtotal,
      total: subtotal,
      deposit_amount: Math.round(subtotal * 0.5 * 100) / 100,
      ai_model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      generation_cost_usd: costUsd,
      ai_warnings: warnings,
    })
    .select()
    .single()
  if (proposalError) return serverError(proposalError.message)

  const { error: itemsError } = await db
    .from('proposal_line_items')
    .insert(lineItems.map((li) => ({ ...li, proposal_id: proposal.id })))
  if (itemsError) return serverError(itemsError.message)

  const flaggedCount = lineItems.filter((li) => li.needs_review).length

  await logEvent('proposal', proposal.id, 'proposal_generated', {
    lead_id: body.lead_id,
    total: subtotal,
    line_items: lineItems.length,
    flagged: flaggedCount,
    cost_usd: costUsd,
    tokens: { input: inputTokens, output: outputTokens },
    autopilot_requested: body.autopilot === true,
  })

  // Autopilot (opt-in per generation): auto-send ONLY a fully clean draft.
  // A single flagged line — off-catalog item, out-of-band price, low
  // confidence — holds it for human review; the model never gets the last
  // word on an uncertain number.
  if (body.autopilot === true && flaggedCount === 0 && lineItems.length > 0 && subtotal > 0) {
    const now = new Date().toISOString()
    const { data: sent, error: sendError } = await db
      .from('proposals')
      .update({ status: 'sent', sent_at: now, updated_at: now })
      .eq('id', proposal.id)
      .select()
      .single()
    if (sendError) return serverError(sendError.message)

    await db.from('leads').update({ status: 'proposal_sent' }).eq('id', body.lead_id)

    const clientUrl = `${process.env.PUBLIC_BASE_URL ?? ''}/p/${sent.client_token}`
    await logEvent('proposal', proposal.id, 'proposal_sent', {
      total: sent.total,
      client_url: clientUrl,
      autopilot: true,
    })
    await notifySlack(
      `🤖 *Autopilot sent proposal (zero flags):* ${lead.name} — ${money(sent.total)}\nEvery line matched the catalog inside its price band, so it skipped review.\nClient link: ${clientUrl}`,
    )
    return json({ proposal: sent, line_items: lineItems, autopilot_sent: true }, 201)
  }

  await db.from('leads').update({ status: 'site_walk_done' }).eq('id', body.lead_id)

  const heldNote =
    body.autopilot === true
      ? ` · 🤖 autopilot HELD it — ${flaggedCount} flagged line(s) need a human`
      : ''
  await notifySlack(
    `📝 *Draft proposal ready for review:* ${lead.name} — ${money(subtotal)} (${lineItems.length} items, ${flaggedCount} flagged) · AI cost ${costUsd < 0.01 ? '<$0.01' : '$' + costUsd.toFixed(2)}${heldNote}`,
  )

  return json({ proposal, line_items: lineItems }, 201)
})
