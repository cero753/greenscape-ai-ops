import { getSupabase } from './_lib/supabase'
import { json, methodNotAllowed, serverError } from './_lib/http'

/** GET /api/catalog -> full pricing catalog, grouped client-side. */
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return methodNotAllowed()

  const { data, error } = await getSupabase()
    .from('pricing_catalog')
    .select('*')
    .order('category')
    .order('code')
  if (error) return serverError(error.message)
  return json({ items: data })
}
