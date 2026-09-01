import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase client using the service role key.
 * All tables have RLS enabled with zero anon policies, so this is the only
 * path to the database. The key never leaves Netlify Functions.
 */
let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured')
  }
  if (!client) {
    client = createClient(url, key, { auth: { persistSession: false } })
  }
  return client
}

/** Append to the audit log. Failures are logged but never break the main flow. */
export async function logEvent(
  entityType: string,
  entityId: string | null,
  eventType: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await getSupabase().from('events').insert({
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      detail,
    })
  } catch (err) {
    console.error('logEvent failed', err)
  }
}
