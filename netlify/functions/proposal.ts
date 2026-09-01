import { getSupabase, logEvent } from './_lib/supabase'
import { json, badRequest, methodNotAllowed, notFound, parseBody, serverError, withErrors } from './_lib/http'
import { notifySlack, money } from './_lib/slack'

/**
 * Admin proposal API (human-in-the-loop review).
 *
 * GET   /api/proposal?id=<id>          -> proposal + line items + lead
 * PATCH /api/proposal?id=<id>          -> edit scope/notes/line items (recomputes totals)
 * POST  /api/proposal?id=<id>&action=approve-send -> approve & "send" to client
 *
 * Editing or approving clears per-line review flags the human has touched:
 * once Marcus sets a price, it is his number, not the model's.
 */

interface LineItemInput {
  id?: string
  catalog_item_id?: string | null
  description: string
  qty: number
  unit: string
  unit_price: number
  sort_order: number
}

interface PatchBody {
  scope_summary?: string
  client_note?: string
  line_items?: LineItemInput[]
}

export default withErrors(async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return badRequest('id is required')
  const db = getSupabase()

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('proposals')
      .select('*, proposal_line_items(*), leads(*)')
      .eq('id', id)
      .single()
    if (error || !data) return notFound('Proposal not found')
    data.proposal_line_items.sort(
      (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
    )
    return json({ proposal: data })
  }

  if (req.method === 'PATCH') {
    const body = await parseBody<PatchBody>(req)
    if (!body) return badRequest('Invalid JSON body')

    const { data: existing, error: getError } = await db
      .from('proposals')
      .select('id, status')
      .eq('id', id)
      .single()
    if (getError || !existing) return notFound('Proposal not found')
    if (['sent', 'viewed', 'accepted', 'declined'].includes(existing.status)) {
      return badRequest(`Proposal already ${existing.status} — cannot edit`)
    }

    let subtotal: number | undefined
    if (body.line_items) {
      for (const li of body.line_items) {
        if (!li.description?.trim() || !(li.qty > 0) || li.unit_price < 0) {
          return badRequest('Each line item needs a description, qty > 0 and unit_price >= 0')
        }
      }
      // Replace-all is simpler and safer than diffing for a review UI.
      const { error: delError } = await db.from('proposal_line_items').delete().eq('proposal_id', id)
      if (delError) return serverError(delError.message)

      const rows = body.line_items.map((li, i) => ({
        proposal_id: id,
        catalog_item_id: li.catalog_item_id ?? null,
        description: li.description.trim(),
        qty: li.qty,
        unit: li.unit,
        unit_price: li.unit_price,
        line_total: Math.round(li.qty * li.unit_price * 100) / 100,
        confidence: 1, // human-entered/confirmed
        needs_review: false,
        review_reason: null,
        sort_order: i,
      }))
      const { error: insError } = await db.from('proposal_line_items').insert(rows)
      if (insError) return serverError(insError.message)
      subtotal = rows.reduce((sum, r) => sum + r.line_total, 0)
    }

    const patch: Record<string, unknown> = {}
    if (body.scope_summary !== undefined) patch.scope_summary = body.scope_summary
    if (body.client_note !== undefined) patch.client_note = body.client_note
    if (subtotal !== undefined) {
      patch.subtotal = subtotal
      patch.total = subtotal
      patch.deposit_amount = Math.round(subtotal * 0.5 * 100) / 100
    }
    if (existing.status === 'needs_clarification' && body.line_items?.length) {
      patch.status = 'pending_review' // human resolved the clarification manually
    }

    const { data: updated, error: updError } = await db
      .from('proposals')
      .update(patch)
      .eq('id', id)
      .select('*, proposal_line_items(*)')
      .single()
    if (updError) return serverError(updError.message)

    await logEvent('proposal', id, 'proposal_edited', {
      fields: Object.keys(patch),
      line_items: body.line_items?.length,
    })
    return json({ proposal: updated })
  }

  if (req.method === 'POST') {
    if (url.searchParams.get('action') !== 'approve-send') {
      return badRequest('Unknown action')
    }

    const { data: proposal, error: getError } = await db
      .from('proposals')
      .select('*, proposal_line_items(needs_review), leads(name, email)')
      .eq('id', id)
      .single()
    if (getError || !proposal) return notFound('Proposal not found')

    if (proposal.status !== 'pending_review' && proposal.status !== 'approved') {
      return badRequest(`Proposal is ${proposal.status} — only pending_review proposals can be sent`)
    }
    const flagged = proposal.proposal_line_items.filter(
      (li: { needs_review: boolean }) => li.needs_review,
    ).length
    if (flagged > 0) {
      return badRequest(
        `${flagged} line item(s) still flagged for review — resolve (edit/confirm) them before sending`,
      )
    }
    if (!proposal.proposal_line_items.length || !(proposal.total > 0)) {
      return badRequest('Proposal has no priced line items')
    }

    const now = new Date().toISOString()
    const { data: sent, error: updError } = await db
      .from('proposals')
      .update({ status: 'sent', sent_at: now, updated_at: now })
      .eq('id', id)
      .select()
      .single()
    if (updError) return serverError(updError.message)

    await db.from('leads').update({ status: 'proposal_sent' }).eq('id', sent.lead_id)

    const clientUrl = `${process.env.PUBLIC_BASE_URL ?? ''}/p/${sent.client_token}`
    await logEvent('proposal', id, 'proposal_sent', { total: sent.total, client_url: clientUrl })
    await notifySlack(
      `✅ *Proposal approved & sent:* ${proposal.leads?.name} — ${money(sent.total)}\nClient link: ${clientUrl}`,
    )

    // In production this would also email the link via GHL; here the Slack
    // message + client URL is the delivery mechanism.
    return json({ proposal: sent, client_url: clientUrl })
  }

  return methodNotAllowed()
})
