import { getSupabase } from './_lib/supabase'
import { json, methodNotAllowed, serverError, notFound, withErrors } from './_lib/http'

/**
 * GET /api/leads          -> all leads with their proposals (newest first)
 * GET /api/leads?id=<id>  -> single lead with proposals
 *
 * Nested proposals are explicitly ordered newest-first: a lead can hold more
 * than one proposal (a revised quote after a scope change), and the dashboard
 * row renders `proposals[0]`. Without an explicit order PostgREST returns them
 * in physical order, so a signed lead could show a stale draft's total.
 */
export default withErrors(async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return methodNotAllowed()

  const id = new URL(req.url).searchParams.get('id')
  const db = getSupabase()

  if (id) {
    const { data, error } = await db
      .from('leads')
      .select('*, proposals(id, status, total, generation_cost_usd, created_at, sent_at, accepted_at)')
      .eq('id', id)
      .order('created_at', { referencedTable: 'proposals', ascending: false })
      .single()
    if (error) return notFound('Lead not found')
    return json({ lead: data })
  }

  const { data, error } = await db
    .from('leads')
    .select('*, proposals(id, status, total, created_at)')
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'proposals', ascending: false })
  if (error) return serverError(error.message)
  return json({ leads: data })
})
