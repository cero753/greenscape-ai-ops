import { getSupabase } from './_lib/supabase'
import { json, methodNotAllowed, serverError, notFound } from './_lib/http'

/**
 * GET /api/leads          -> all leads with their proposals (newest first)
 * GET /api/leads?id=<id>  -> single lead with proposals
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return methodNotAllowed()

  const id = new URL(req.url).searchParams.get('id')
  const db = getSupabase()

  if (id) {
    const { data, error } = await db
      .from('leads')
      .select('*, proposals(id, status, total, generation_cost_usd, created_at, sent_at, accepted_at)')
      .eq('id', id)
      .single()
    if (error) return notFound('Lead not found')
    return json({ lead: data })
  }

  const { data, error } = await db
    .from('leads')
    .select('*, proposals(id, status, total, created_at)')
    .order('created_at', { ascending: false })
  if (error) return serverError(error.message)
  return json({ leads: data })
}
