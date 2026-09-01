import { getSupabase, logEvent } from './_lib/supabase'
import { json, badRequest, methodNotAllowed, parseBody, serverError } from './_lib/http'
import { notifySlack } from './_lib/slack'

/**
 * Simulated GoHighLevel/Zapier lead webhook.
 * In production this endpoint would be the Zapier target for Meta instant
 * forms (the client's existing routing: Meta form -> Zapier -> GHL -> here).
 * Payload shape mirrors a GHL contact webhook.
 */
interface GhlPayload {
  full_name?: string
  email?: string
  phone?: string
  address?: string
  source?: string
  project_type?: string
  budget_range?: string
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return methodNotAllowed()

  const body = await parseBody<GhlPayload>(req)
  if (!body || !body.full_name) {
    return badRequest('full_name is required')
  }

  const source = ['meta', 'google_lsa', 'referral', 'manual'].includes(body.source ?? '')
    ? (body.source as string)
    : 'manual'

  const { data: lead, error } = await getSupabase()
    .from('leads')
    .insert({
      name: body.full_name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      address: body.address ?? null,
      source,
      project_type: body.project_type ?? null,
      budget_range: body.budget_range ?? null,
      raw_payload: body,
    })
    .select()
    .single()

  if (error) return serverError(error.message)

  await logEvent('lead', lead.id, 'lead_created', { source, name: lead.name })
  await notifySlack(
    `🌵 *New lead:* ${lead.name} — ${lead.project_type ?? 'unspecified project'} (${lead.budget_range ?? 'no budget given'}) via ${source}`,
  )

  return json({ lead }, 201)
}
