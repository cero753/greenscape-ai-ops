import { getSupabase, logEvent } from './_lib/supabase'
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
 * tool-use loop with read-only database tools. This function only records
 * the question and kicks the worker.
 *
 * Assumption (documented in README): Slack request-signature verification
 * is skipped for the demo; production would verify X-Slack-Signature with
 * the app's signing secret before trusting the payload.
 */

export default withErrors(async (req: Request): Promise<Response> => {
  const db = getSupabase()

  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return badRequest('id query param required')
    const { data, error } = await db
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

  const { data: row, error } = await db
    .from('assistant_queries')
    .insert({ question, source, asked_by: askedBy, response_url: responseUrl })
    .select()
    .single()
  if (error) return serverError(error.message)

  await logEvent('assistant_query', row.id, 'question_asked', { source, question })

  // Kick the background worker. Background functions ack with 202 instantly,
  // so awaiting this stays well inside Slack's 3-second reply window.
  const base = process.env.PUBLIC_BASE_URL
  if (!base) return serverError('PUBLIC_BASE_URL is not configured')
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

  if (source === 'slack') {
    return json({ response_type: 'ephemeral', text: `🔎 Digging through the pipeline for you…` })
  }
  return json({ query_id: row.id }, 202)
})
