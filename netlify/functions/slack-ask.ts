import { json, badRequest, methodNotAllowed, notFound, serverError, withErrors } from './_lib/http'

/**
 * /api/slack-ask — entry point for the pipeline Q&A agent.
 *
 * Accepts a question from either surface:
 *  - Slack slash command (form-encoded: text, response_url, user_name) —
 *    answers within Slack's 3s window with an ephemeral ack, then the
 *    background worker POSTs the real answer to response_url.
 *  - The admin dashboard (JSON: { question }) — returns { query_id } and
 *    the UI polls GET /api/slack-ask?id=<query_id> until answered.
 *
 * The actual answering happens in slack-ask-background.ts: a Claude
 * tool-use loop with read-only database tools.
 *
 * Cold-start note: Slack kills slash commands that don't ack in 3 seconds,
 * and a cold boot of this function measured 3.07s when the ack path did
 * DB work (Supabase client init + insert + event log). So the Slack branch
 * touches no database at all — it validates, forwards the raw question to
 * the background worker (which acks 202 at the platform level before it
 * even boots), and replies. The worker inserts the assistant_queries row.
 * Supabase is loaded via dynamic import so the Slack path never pays for it.
 *
 * Assumption (documented in README): Slack request-signature verification
 * is skipped for the demo; production would verify X-Slack-Signature with
 * the app's signing secret before trusting the payload.
 */

export default withErrors(async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return badRequest('id query param required')
    const { getSupabase } = await import('./_lib/supabase')
    const { data, error } = await getSupabase()
      .from('assistant_queries')
      .select('id, question, answer, status, created_at, answered_at, generation_cost_usd')
      .eq('id', id)
      .single()
    if (error || !data) return notFound('Query not found')
    return json(data)
  }

  if (req.method !== 'POST') return methodNotAllowed()

  // Slack slash commands arrive form-encoded; the dashboard sends JSON.
  const contentType = req.headers.get('content-type') ?? ''
  let question = ''
  let source: 'admin' | 'slack' = 'admin'
  let askedBy: string | null = null
  let responseUrl: string | null = null

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(await req.text())
    question = (form.get('text') ?? '').trim()
    source = 'slack'
    askedBy = form.get('user_name')
    responseUrl = form.get('response_url')
  } else {
    try {
      const body = (await req.json()) as { question?: string }
      question = (body.question ?? '').trim()
    } catch {
      return badRequest('Invalid JSON body')
    }
  }

  if (!question) {
    return source === 'slack'
      ? json({ response_type: 'ephemeral', text: 'Ask me something, e.g. `/ask how many proposals are waiting for review?`' })
      : badRequest('question is required')
  }
  if (question.length > 500) {
    return source === 'slack'
      ? json({ response_type: 'ephemeral', text: 'Keep questions under 500 characters.' })
      : badRequest('Keep questions under 500 characters')
  }

  const base = process.env.PUBLIC_BASE_URL
  if (!base) return serverError('PUBLIC_BASE_URL is not configured')

  if (source === 'slack') {
    // Zero-DB fast path — see cold-start note above. The worker owns the
    // assistant_queries insert for Slack-originated questions.
    try {
      await fetch(`${base}/api/slack-ask-background`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, asked_by: askedBy, response_url: responseUrl }),
      })
    } catch (err) {
      return json({ response_type: 'ephemeral', text: `Sorry — couldn't start the answer worker. (${String(err)})` })
    }
    return json({ response_type: 'ephemeral', text: `🔎 Digging through the pipeline for you…` })
  }

  // Dashboard path: create the row here so the UI gets a query_id to poll.
  const { getSupabase, logEvent } = await import('./_lib/supabase')
  const db = getSupabase()
  const { data: row, error } = await db
    .from('assistant_queries')
    .insert({ question, source, asked_by: askedBy, response_url: responseUrl })
    .select()
    .single()
  if (error) return serverError(error.message)

  await logEvent('assistant_query', row.id, 'question_asked', { source, question })

  try {
    await fetch(`${base}/api/slack-ask-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query_id: row.id }),
    })
  } catch (err) {
    await db.from('assistant_queries').update({ status: 'failed', answer: 'Could not start the answer worker.' }).eq('id', row.id)
    return serverError(`Failed to start worker: ${String(err)}`)
  }

  return json({ query_id: row.id }, 202)
})
