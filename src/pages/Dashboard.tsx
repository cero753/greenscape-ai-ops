import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { Lead } from '../lib/types'
import { LEAD_STATUS, SOURCE_LABEL, money, timeAgo } from '../lib/format'
import { SIMULATED_LEADS } from '../lib/samples'
import { Badge, Button, ErrorNote, Panel, Spinner } from '../components/ui'

const ASK_SUGGESTIONS = [
  'How much proposal value is sitting unsigned right now?',
  'Which closed-lost leads are worth the most?',
  'What have we spent on AI so far?',
]

/**
 * "Ask your pipeline" — front door to the Q&A agent. POSTs the question,
 * then polls /api/slack-ask?id= while the background Claude tool-use loop
 * queries the database. Same agent answers /ask in Slack.
 */
function AskPipeline() {
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [askError, setAskError] = useState('')
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [])

  async function ask(q: string) {
    const trimmed = q.trim()
    if (!trimmed || asking) return
    setAsking(true)
    setAnswer(null)
    setAskError('')
    try {
      const { query_id } = await api.askPipeline(trimmed)
      const deadline = Date.now() + 90_000
      const poll = async () => {
        try {
          const status = await api.askStatus(query_id)
          if (status.status === 'answered') {
            setAnswer(status.answer ?? '')
            setAsking(false)
            return
          }
          if (status.status === 'failed') {
            setAskError(status.answer ?? 'The agent could not answer that.')
            setAsking(false)
            return
          }
        } catch {
          // transient poll failure — keep trying until the deadline
        }
        if (Date.now() > deadline) {
          setAskError('Timed out waiting for an answer — try again.')
          setAsking(false)
          return
        }
        pollTimer.current = window.setTimeout(poll, 2000)
      }
      pollTimer.current = window.setTimeout(poll, 2000)
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'Failed to ask')
      setAsking(false)
    }
  }

  return (
    <Panel className="rise rise-3 overflow-hidden">
      <div className="flex items-center justify-between border-b border-edge px-5 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">
          Ask your pipeline · Claude agent with read-only DB tools
        </span>
        <span className="font-mono text-[10px] text-fog/60">also answers /ask in Slack</span>
      </div>
      <div className="space-y-3 p-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            ask(question)
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. which pending proposals are worth the most?"
            className="min-w-0 flex-1 rounded-lg border border-edge2 bg-panel2 px-4 py-2 text-sm text-bone placeholder:text-fog/50 focus:border-terra focus:outline-none"
            maxLength={500}
            disabled={asking}
          />
          <Button type="submit" disabled={asking || !question.trim()}>
            {asking ? <Spinner /> : 'Ask'}
          </Button>
        </form>
        {!asking && !answer && !askError && (
          <div className="flex flex-wrap gap-2">
            {ASK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuestion(s)
                  ask(s)
                }}
                className="rounded-full border border-edge2 bg-panel2 px-3 py-1 font-mono text-[11px] text-fog transition-colors hover:border-fog hover:text-bone"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {asking && <Spinner label="Claude is querying the pipeline…" />}
        {askError && <ErrorNote message={askError} />}
        {answer && (
          <div className="whitespace-pre-wrap rounded-lg border border-terra/30 bg-terra/5 px-4 py-3 text-sm leading-relaxed text-bone">
            {answer}
          </div>
        )}
      </div>
    </Panel>
  )
}

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState('')
  const [simulating, setSimulating] = useState(false)

  const load = useCallback(async () => {
    try {
      const { leads } = await api.leads()
      setLeads(leads)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    if (!leads) return null
    const proposals = leads.flatMap((l) => l.proposals ?? [])
    const pending = proposals.filter((p) => p.status === 'pending_review')
    const out = proposals.filter((p) => ['sent', 'viewed'].includes(p.status))
    const won = proposals.filter((p) => p.status === 'accepted')
    return {
      leads: leads.length,
      pending: pending.length,
      outValue: out.reduce((s, p) => s + Number(p.total || 0), 0),
      wonValue: won.reduce((s, p) => s + Number(p.total || 0), 0),
    }
  }, [leads])

  async function simulate() {
    setSimulating(true)
    try {
      const payload = SIMULATED_LEADS[(leads?.length ?? 0) % SIMULATED_LEADS.length]
      await api.simulateLead(payload)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setSimulating(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Quote pipeline</h1>
          <p className="mt-1 max-w-xl text-sm text-fog">
            Every qualified lead should have a proposal in front of them{' '}
            <span className="text-terra">within 48 hours</span> of the site walk — not 6–9 days.
          </p>
        </div>
        <Button onClick={simulate} disabled={simulating} variant="ghost">
          {simulating ? <Spinner label="posting webhook…" /> : '⚡ Simulate incoming lead (GHL webhook)'}
        </Button>
      </div>

      {error && <ErrorNote message={error} />}

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { k: 'Leads in pipeline', v: String(stats.leads), accent: 'text-bone', d: 'rise-1' },
            { k: 'Awaiting your review', v: String(stats.pending), accent: stats.pending ? 'text-sun' : 'text-bone', d: 'rise-2' },
            { k: 'Proposals out', v: money(stats.outValue), accent: 'text-terra', d: 'rise-3' },
            { k: 'Signed', v: money(stats.wonValue), accent: 'text-cactus', d: 'rise-4' },
          ].map((s) => (
            <Panel key={s.k} className={`rise ${s.d} px-5 py-4`}>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">{s.k}</div>
              <div className={`mt-2 font-display text-2xl font-bold ${s.accent}`}>{s.v}</div>
            </Panel>
          ))}
        </div>
      )}

      <AskPipeline />

      <Panel className="rise rise-2 overflow-hidden">
        <div className="border-b border-edge px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fog">
          Leads · newest first
        </div>
        {!leads ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="sweep h-14 rounded-lg" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="p-10 text-center text-sm text-fog">
            No leads yet — hit “Simulate incoming lead” to fire the webhook.
          </div>
        ) : (
          <ul className="divide-y divide-edge">
            {leads.map((lead) => {
              const proposal = lead.proposals?.[0]
              return (
                <li key={lead.id}>
                  <Link
                    to={`/leads/${lead.id}`}
                    className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors hover:bg-panel2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold">{lead.name}</span>
                        <Badge {...LEAD_STATUS[lead.status]} />
                      </div>
                      <div className="mt-0.5 truncate text-xs text-fog">
                        {lead.project_type ?? 'Project type unknown'} ·{' '}
                        {SOURCE_LABEL[lead.source] ?? lead.source} · {timeAgo(lead.created_at)}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-fog">{lead.budget_range ?? ''}</div>
                    {proposal && (
                      <div className="font-mono text-sm text-bone">{money(proposal.total)}</div>
                    )}
                    <span className="text-fog">→</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
