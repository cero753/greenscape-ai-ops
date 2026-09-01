import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { getSupabase, logEvent } from './_lib/supabase'
import { json, badRequest, methodNotAllowed, parseBody, serverError, withErrors } from './_lib/http'
import { notifySlack } from './_lib/slack'

/**
 * POST /api/reactivation-generate-background  { lead_ids?: string[] }
 *
 * Background half of the reactivation module: Claude drafts Marcus-voiced
 * SMS messages for closed-lost leads. Runs as a Netlify background function
 * (202 immediately, up to 15 min) because the batch LLM call exceeds the
 * synchronous function limit. The UI polls /api/reactivation for new drafts.
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
  lead_ids?: string[]
}

export default withErrors(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return methodNotAllowed()
  const body = await parseBody<PostBody>(req)
  const db = getSupabase()

  // Batch-draft for untouched leads (or an explicit subset).
  let query = db.from('closed_lost_leads').select('*').eq('status', 'untouched').limit(5)
  if (body?.lead_ids?.length) {
    query = db.from('closed_lost_leads').select('*').in('id', body.lead_ids)
  }
  const { data: leads, error } = await query
  if (error) return serverError(error.message)
  if (!leads?.length) return badRequest('No untouched closed-lost leads to draft for')

  // Mark as in-flight so the polling UI can show progress and repeat clicks
  // don't double-draft the same leads.
  await db
    .from('closed_lost_leads')
    .update({ status: 'drafting' })
    .in('id', leads.map((l) => l.id))

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
  if (!parsed) {
    // Roll back so the leads become draftable again.
    await db
      .from('closed_lost_leads')
      .update({ status: 'untouched' })
      .in('id', leads.map((l) => l.id))
    await logEvent('reactivation', null, 'generation_failed', { error: lastError })
    return serverError(`AI drafting failed after retry: ${lastError}`)
  }

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
  if (!rows.length) {
    await db
      .from('closed_lost_leads')
      .update({ status: 'untouched' })
      .in('id', leads.map((l) => l.id))
    return serverError('Model produced no usable drafts')
  }

  const { data: drafts, error: insError } = await db.from('outreach_drafts').insert(rows).select()
  if (insError) return serverError(insError.message)

  await db
    .from('closed_lost_leads')
    .update({ status: 'draft_ready' })
    .in('id', rows.map((r) => r.closed_lost_lead_id))
  // Any lead the model skipped goes back to untouched.
  const draftedIds = new Set(rows.map((r) => r.closed_lost_lead_id))
  const skipped = leads.filter((l) => !draftedIds.has(l.id)).map((l) => l.id)
  if (skipped.length) {
    await db.from('closed_lost_leads').update({ status: 'untouched' }).in('id', skipped)
  }

  await logEvent('reactivation', null, 'drafts_generated', {
    count: drafts.length,
    cost_usd: costUsd,
    tokens: { input: inputTokens, output: outputTokens },
  })
  await notifySlack(
    `✍️ *Reactivation drafts ready:* ${drafts.length} Marcus-voiced messages awaiting review (AI cost ${costUsd < 0.01 ? '<$0.01' : '$' + costUsd.toFixed(2)})`,
  )
  return json({ drafts }, 201)
})
