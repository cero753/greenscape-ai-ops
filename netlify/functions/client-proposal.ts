import { getSupabase, logEvent } from './_lib/supabase'
import { json, badRequest, methodNotAllowed, notFound, serverError, withErrors } from './_lib/http'
import { notifySlack, money } from './_lib/slack'

/**
 * Public client-facing proposal API, keyed by unguessable client_token (uuid).
 * Exposes ONLY client-safe fields — no AI metadata, internal notes, or costs.
 *
 * GET  /api/client-proposal?token=<uuid>                 -> view (marks `viewed` once)
 * POST /api/client-proposal?token=<uuid>&action=accept   -> accept the proposal
 */
export default withErrors(async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return badRequest('token is required')
  const db = getSupabase()

  const { data: proposal, error } = await db
    .from('proposals')
    .select(
      'id, status, scope_summary, client_note, subtotal, total, deposit_amount, sent_at, accepted_at, proposal_line_items(description, qty, unit, unit_price, line_total, sort_order), leads(name, address)',
    )
    .eq('client_token', token)
    .single()
  if (error || !proposal) return notFound('Proposal not found')

  // supabase-js types many-to-one joins as arrays; at runtime it's an object.
  const leadInfo = proposal.leads as unknown as { name: string | null; address: string | null } | null

  // Clients can only see proposals that were actually sent.
  if (!['sent', 'viewed', 'accepted'].includes(proposal.status)) {
    return notFound('Proposal not found')
  }

  proposal.proposal_line_items.sort(
    (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
  )

  if (req.method === 'GET') {
    if (proposal.status === 'sent') {
      await db
        .from('proposals')
        .update({ status: 'viewed', viewed_at: new Date().toISOString() })
        .eq('id', proposal.id)
      proposal.status = 'viewed'
      await logEvent('proposal', proposal.id, 'proposal_viewed', {})
      await notifySlack(`👀 *Proposal viewed:* ${leadInfo?.name} — ${money(proposal.total)}`)
    }
    return json({ proposal })
  }

  if (req.method === 'POST') {
    if (url.searchParams.get('action') !== 'accept') return badRequest('Unknown action')
    if (proposal.status === 'accepted') {
      return json({ proposal, message: 'Already accepted' })
    }

    const { data: accepted, error: updError } = await db
      .from('proposals')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', proposal.id)
      .select('id, status, total, deposit_amount, accepted_at, lead_id')
      .single()
    if (updError) return serverError(updError.message)

    await db.from('leads').update({ status: 'won' }).eq('id', accepted.lead_id)

    await logEvent('proposal', proposal.id, 'proposal_accepted', {
      total: accepted.total,
      deposit_due: accepted.deposit_amount,
    })
    // Deposit-invoice stub: in production this triggers a Stripe invoice for
    // the 50% deposit; here it lands in Slack + events for the demo.
    await notifySlack(
      `🎉 *PROPOSAL SIGNED:* ${leadInfo?.name} — ${money(accepted.total)}!\n` +
        `Next step: 50% deposit invoice (${money(accepted.deposit_amount)}) via Stripe.`,
    )

    return json({
      proposal: { ...proposal, status: 'accepted', accepted_at: accepted.accepted_at },
      deposit_due: accepted.deposit_amount,
    })
  }

  return methodNotAllowed()
})
