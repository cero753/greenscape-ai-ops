import { getSupabase, logEvent } from './_lib/supabase'
import { json, badRequest, methodNotAllowed, notFound, parseBody, serverError, withErrors } from './_lib/http'
import { notifySlack, money } from './_lib/slack'

/**
 * Stretch module: Closed-Lost Reactivation (strategy agent #3).
 * 1,400 closed-lost leads ≈ $784K latent pipeline at a 2% re-close rate.
 *
 * GET  /api/reactivation                      -> closed-lost leads + drafts
 * POST /api/reactivation  {action:'send', draft_id}
 *        Approve + "send" one draft (Slack simulates the GHL SMS send)
 * POST /api/reactivation  {action:'reject', draft_id}
 *
 * Drafting itself lives in /api/reactivation-generate-background (the LLM
 * call outlives a synchronous function's limit). Same guardrail philosophy
 * as proposals: the model drafts, a human approves, nothing reaches a lead
 * automatically.
 */

interface PostBody {
  action?: 'send' | 'reject'
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
