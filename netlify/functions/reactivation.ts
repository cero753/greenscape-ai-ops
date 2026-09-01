import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { getSupabase, logEvent } from './_lib/supabase'
import { json, badRequest, methodNotAllowed, notFound, parseBody, serverError, withErrors } from './_lib/http'
import { notifySlack, money } from './_lib/slack'

/**
 * Stretch module: Closed-Lost Reactivation (strategy agent #3).
 * 1,400 closed-lost leads ≈ $784K latent pipeline at a 2% re-close rate.
 *
 * GET  /api/reactivation                      -> closed-lost leads + drafts
 * POST /api/reactivation  {action:'generate', lead_ids?: string[]}
 *        Claude writes Marcus-voiced SMS drafts (batch, HITL like proposals)
 * POST /api/reactivation  {action:'send', draft_id}
 *        Approve + "send" one draft (Slack simulates the GHL SMS send)
 * POST /api/reactivation  {action:'reject', draft_id}
 *
 * Same guardrail philosophy as proposals: the model drafts, a human approves,
 * nothing reaches a lead automatically.
 */

const MODEL = 'claude-sonnet-4-6'
const INPUT_COST_PER_M = 3
const OUTPUT_COST_PER_M = 15

const DraftSchema = z.object({
  drafts: z
    .array(
      z.object({
        lead_id: z.string().describe('The closed-lost lead id this message is for'),
        message: z
          .string()
          .describe(
            'SMS from Marcus, 320 chars max: personal, references their specific project/context, no salesy pressure, one soft question. Never mention discounts unless the lost reason was price.',
          ),
      }),
    )
    .describe('One draft per lead'),
})

interface PostBody {
  action?: 'generate' | 'send' | 'reject'
  lead_ids?: string[]
  draft_id?: string
}

export default withErrors(async (req: Request): Promise<Response> => {
  const db = getSupabase()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('closed_lost_leads')
      .select('*, outreach_drafts(*)')
      .order('quoted_amount', { ascending: false })
    if (error) return serverError(error.message)
    return json({ leads: data })
  }

  if (req.method !== 'POST') return methodNotAllowed()
  const body = await parseBody<PostBody>(req)
  if (!body?.action) return badRequest('action is required')

  if (body.action === 'generate') {
    // Batch-draft for untouched leads (or an explicit subset).
    let query = db.from('closed_lost_leads').select('*').eq('status', 'untouched').limit(5)
    if (body.lead_ids?.length) {
      query = db.from('closed_lost_leads').select('*').in('id', body.lead_ids)
    }
    const { data: leads, error } = await query
    if (error) return serverError(error.message)
    if (!leads?.length) return badRequest('No untouched closed-lost leads to draft for')

    const leadBlock = leads
      .map(
        (l) =>
          `- id: ${l.id}\n  name: ${l.name}\n  project: ${l.project_type ?? 'unknown'}\n  quoted: ${l.quoted_amount ? '$' + l.quoted_amount : 'unknown'}\n  lost because: ${l.lost_reason ?? 'unknown'}\n  last contact: ${l.last_contact_date ?? 'unknown'}\n  GHL notes: ${l.ghl_notes ?? 'none'}`,
      )
      .join('\n')

    const prompt = `You are drafting reactivation SMS messages on behalf of Marcus Tate, owner of Greenscape Pro, a premium hardscape/landscape design-build company in Phoenix. These leads got quotes in the past but didn't move forward. Write ONE personal SMS per lead below.

Marcus's voice: warm, direct, craftsman-proud, zero corporate speak. He remembers details about people's yards. Keep each under 320 characters. Reference their specific project and context. End with one low-pressure question. Do not use emojis, exclamation marks, or the word "deal". Only mention pricing/discounts if they were lost on price.

LEADS:
${leadBlock}`

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    let parsed: z.infer<typeof DraftSchema> | null = null
    let inputTokens = 0
    let outputTokens = 0
    let lastError = ''
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const response = await client.messages.parse({
          model: MODEL,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: zodOutputFormat(DraftSchema) },
        })
        inputTokens += response.usage.input_tokens
        outputTokens += response.usage.output_tokens
        parsed = response.parsed_output ?? null
        if (!parsed) lastError = 'Model returned no parseable output'
      } catch (err) {
        lastError = err instanceof Anthropic.APIError ? `${err.status}: ${err.message}` : String(err)
        console.error(`reactivation generate attempt ${attempt + 1} failed:`, lastError)
      }
    }
    if (!parsed) return serverError(`AI drafting failed after retry: ${lastError}`)

    const costUsd = (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000
    const perDraftCost = Math.round((costUsd / Math.max(parsed.drafts.length, 1)) * 100000) / 100000

    // Guardrail: only accept drafts for leads we actually asked about.
    const validIds = new Set(leads.map((l) => l.id))
    const rows = parsed.drafts
      .filter((d) => validIds.has(d.lead_id) && d.message.trim().length > 0)
      .map((d) => ({
        closed_lost_lead_id: d.lead_id,
        channel: 'sms',
        message: d.message.trim().slice(0, 480),
        status: 'pending_review',
        ai_model: MODEL,
        generation_cost_usd: perDraftCost,
      }))
    if (!rows.length) return serverError('Model produced no usable drafts')

    const { data: drafts, error: insError } = await db.from('outreach_drafts').insert(rows).select()
    if (insError) return serverError(insError.message)

    await db
      .from('closed_lost_leads')
      .update({ status: 'draft_ready' })
      .in('id', rows.map((r) => r.closed_lost_lead_id))

    await logEvent('reactivation', null, 'drafts_generated', {
      count: drafts.length,
      cost_usd: costUsd,
      tokens: { input: inputTokens, output: outputTokens },
    })
    await notifySlack(
      `✍️ *Reactivation drafts ready:* ${drafts.length} Marcus-voiced messages awaiting review (AI cost ${costUsd < 0.01 ? '<$0.01' : '$' + costUsd.toFixed(2)})`,
    )
    return json({ drafts }, 201)
  }

  if (body.action === 'send' || body.action === 'reject') {
    if (!body.draft_id) return badRequest('draft_id is required')
    const { data: draft, error } = await db
      .from('outreach_drafts')
      .select('*, closed_lost_leads(name, quoted_amount)')
      .eq('id', body.draft_id)
      .single()
    if (error || !draft) return notFound('Draft not found')
    if (draft.status !== 'pending_review') {
      return badRequest(`Draft already ${draft.status}`)
    }

    if (body.action === 'reject') {
      await db.from('outreach_drafts').update({ status: 'rejected' }).eq('id', draft.id)
      await logEvent('reactivation', draft.id, 'draft_rejected', {})
      return json({ ok: true })
    }

    const { data: sent, error: updError } = await db
      .from('outreach_drafts')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', draft.id)
      .select()
      .single()
    if (updError) return serverError(updError.message)

    await db.from('closed_lost_leads').update({ status: 'sent' }).eq('id', draft.closed_lost_lead_id)

    const lead = draft.closed_lost_leads as unknown as { name: string; quoted_amount: number | null } | null
    await logEvent('reactivation', draft.id, 'outreach_sent', { lead: lead?.name })
    // Production: GHL SMS API. Demo: the Slack message IS the send.
    await notifySlack(
      `📤 *Reactivation SMS sent* to ${lead?.name} (was quoted ${money(lead?.quoted_amount)}):\n> ${sent.message}`,
    )
    return json({ draft: sent })
  }

  return badRequest('Unknown action')
})
