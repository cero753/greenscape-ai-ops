import Anthropic from '@anthropic-ai/sdk'
import { getSupabase, logEvent } from './_lib/supabase'
import { json, badRequest, methodNotAllowed, parseBody, serverError, withErrors } from './_lib/http'

/**
 * POST /api/slack-ask-background
 *   { query_id: string }                                  — dashboard flow
 *   { question, asked_by?, response_url? }                — Slack flow
 *
 * Slack questions arrive as the raw payload (not a query_id) because the
 * entry function's ack path must stay DB-free to beat Slack's 3-second
 * timeout on cold starts — so this worker owns the assistant_queries
 * insert for Slack-originated questions.
 *
 * The answering half of the pipeline Q&A agent: a proper agentic tool-use
 * loop. Claude gets four READ-ONLY database tools and decides which to
 * call (and how many times) to answer an open-ended question like
 * "which pending proposals are worth the most?" or "how much have we
 * spent on AI this month?".
 *
 * Why an agent here and workflows everywhere else: proposal generation and
 * reactivation move money and send things to clients, so their control flow
 * is code-owned with the model doing one constrained step. Q&A is
 * open-ended reads — the model choosing its own queries is the feature,
 * and the blast radius is zero because every tool is a SELECT.
 *
 * Runs as a background function; the entry point (slack-ask.ts) already
 * answered the caller. Results land in assistant_queries (dashboard polls)
 * and are POSTed to Slack's response_url when the question came from Slack.
 */

const MODEL = 'claude-sonnet-4-6'
const INPUT_COST_PER_M = 3
const OUTPUT_COST_PER_M = 15
const MAX_TURNS = 6

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'pipeline_stats',
    description:
      'Aggregate pipeline overview: lead counts by status, proposal counts and dollar totals by status, closed-lost reactivation counts and latent pipeline value, and total AI spend. Call this first for any "how many / how much / overall" question.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_leads',
    description:
      'List active leads (newest first), optionally filtered by status. Statuses: new, qualified, site_walk_done, proposal_sent, won, lost.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional lead status filter' },
        limit: { type: 'number', description: 'Max rows, default 20' },
      },
      required: [],
    },
  },
  {
    name: 'find_lead',
    description:
      'Find a lead by (partial, case-insensitive) name and return full detail: contact info, status, and every proposal with totals, status, and AI cost.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full or partial client name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_reactivation',
    description:
      'Closed-lost reactivation queue: dormant leads with quoted amounts, lost reasons, statuses, and their outreach draft statuses. Sorted by quoted amount descending.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows, default 20' },
      },
      required: [],
    },
  },
]

/** Every tool is a plain SELECT — the agent cannot write anything. */
async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const db = getSupabase()

  if (name === 'pipeline_stats') {
    const [leads, proposals, closedLost, drafts] = await Promise.all([
      db.from('leads').select('status'),
      db.from('proposals').select('status, total, generation_cost_usd'),
      db.from('closed_lost_leads').select('status, quoted_amount'),
      db.from('outreach_drafts').select('status'),
    ])
    const countBy = (rows: { status: string }[] | null) =>
      (rows ?? []).reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1
        return acc
      }, {})
    const proposalRows = proposals.data ?? []
    const totalsByStatus = proposalRows.reduce<Record<string, number>>((acc, r) => {
      if (r.total) acc[r.status] = (acc[r.status] ?? 0) + Number(r.total)
      return acc
    }, {})
    const closedRows = closedLost.data ?? []
    return {
      leads_by_status: countBy(leads.data),
      proposals_by_status: countBy(proposalRows),
      proposal_dollars_by_status: totalsByStatus,
      closed_lost: {
        by_status: countBy(closedRows),
        total_quoted_value: closedRows.reduce((s, r) => s + Number(r.quoted_amount ?? 0), 0),
      },
      outreach_drafts_by_status: countBy(drafts.data),
      total_ai_spend_usd: proposalRows.reduce((s, r) => s + Number(r.generation_cost_usd ?? 0), 0),
    }
  }

  if (name === 'list_leads') {
    const limit = Math.min(Number(input.limit) || 20, 50)
    let q = db
      .from('leads')
      .select('id, name, status, project_type, budget_range, source, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (typeof input.status === 'string' && input.status) q = q.eq('status', input.status)
    const { data, error } = await q
    if (error) return { error: error.message }
    return { leads: data }
  }

  if (name === 'find_lead') {
    const { data, error } = await db
      .from('leads')
      .select(
        'id, name, email, phone, address, status, project_type, budget_range, source, created_at, proposals(id, status, total, deposit_amount, generation_cost_usd, sent_at, accepted_at)',
      )
      .ilike('name', `%${String(input.name ?? '').replace(/[%_]/g, '')}%`)
      .limit(5)
    if (error) return { error: error.message }
    if (!data?.length) return { error: `No lead found matching "${input.name}"` }
    return { matches: data }
  }

  if (name === 'list_reactivation') {
    const limit = Math.min(Number(input.limit) || 20, 50)
    const { data, error } = await db
      .from('closed_lost_leads')
      .select(
        'id, name, project_type, quoted_amount, lost_reason, last_contact_date, status, outreach_drafts(status, message, sent_at)',
      )
      .order('quoted_amount', { ascending: false })
      .limit(limit)
    if (error) return { error: error.message }
    return { closed_lost_leads: data }
  }

  return { error: `Unknown tool: ${name}` }
}

const SYSTEM_PROMPT = `You are the pipeline assistant for Greenscape Pro, a premium hardscape/landscape design-build company in Phoenix run by Marcus Tate. You answer questions about the sales pipeline: leads, proposals, revenue, AI costs, and the closed-lost reactivation queue.

Use the tools to look up real data — never guess numbers. Answer concisely for Slack: 2-6 short lines, plain text (no markdown headers or tables; Slack bold *like this* is fine). Lead with the number or fact asked for, then one line of useful context. Format dollars like $28,400. If the question is not about the Greenscape pipeline, say so briefly and don't call tools.`

interface PostBody {
  query_id?: string
  question?: string
  asked_by?: string | null
  response_url?: string | null
}

export default withErrors(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return methodNotAllowed()
  const body = await parseBody<PostBody>(req)

  const db = getSupabase()
  let query: { id: string; question: string; response_url: string | null; status: string }

  if (body?.query_id) {
    // Dashboard flow: the entry function already created the row.
    const { data, error } = await db
      .from('assistant_queries')
      .select('*')
      .eq('id', body.query_id)
      .single()
    if (error || !data) return badRequest('Query not found')
    if (data.status !== 'running') return json({ ok: true, note: 'Already processed' })
    query = data
  } else if (body?.question?.trim()) {
    // Slack flow: the entry function stayed DB-free to ack fast, so the
    // row gets created here.
    const question = body.question.trim().slice(0, 500)
    const { data, error } = await db
      .from('assistant_queries')
      .insert({
        question,
        source: 'slack',
        asked_by: body.asked_by ?? null,
        response_url: body.response_url ?? null,
      })
      .select()
      .single()
    if (error) return serverError(error.message)
    query = data
    await logEvent('assistant_query', query.id, 'question_asked', { source: 'slack', question })
  } else {
    return badRequest('query_id or question is required')
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: query.question }]
  let inputTokens = 0
  let outputTokens = 0
  let answer = ''
  let failure = ''

  try {
    // The agent loop: Claude picks tools until it has enough to answer.
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      })
      inputTokens += response.usage.input_tokens
      outputTokens += response.usage.output_tokens

      if (response.stop_reason !== 'tool_use') {
        answer = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        break
      }

      messages.push({ role: 'assistant', content: response.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const result = await runTool(block.name, (block.input ?? {}) as Record<string, unknown>)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      }
      messages.push({ role: 'user', content: toolResults })
    }
    if (!answer) failure = `No final answer within ${MAX_TURNS} agent turns`
  } catch (err) {
    failure = err instanceof Anthropic.APIError ? `${err.status}: ${err.message}` : String(err)
    console.error('slack-ask agent loop failed:', failure)
  }

  const costUsd =
    Math.round(((inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000) * 100000) / 100000

  await db
    .from('assistant_queries')
    .update({
      status: failure ? 'failed' : 'answered',
      answer: failure ? `Sorry — I couldn't answer that. (${failure})` : answer,
      ai_model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      generation_cost_usd: costUsd,
      answered_at: new Date().toISOString(),
    })
    .eq('id', query.id)

  await logEvent('assistant_query', query.id, failure ? 'answer_failed' : 'answered', {
    cost_usd: costUsd,
    tokens: { input: inputTokens, output: outputTokens },
    ...(failure ? { error: failure } : {}),
  })

  // Slack-originated questions get the answer pushed back to the channel.
  if (query.response_url) {
    try {
      await fetch(query.response_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          response_type: 'in_channel',
          text: failure ? `Sorry — I couldn't answer that. (${failure})` : answer,
        }),
      })
    } catch (err) {
      console.error('Slack response_url post failed:', err)
    }
  }

  return json({ ok: true })
})
