import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { Lead } from '../lib/types'
import { LEAD_STATUS, PROPOSAL_STATUS, SOURCE_LABEL, money, shortDate } from '../lib/format'
import { SAMPLE_NOTES } from '../lib/samples'
import { Badge, Button, ErrorNote, Panel, Spinner } from '../components/ui'

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [lead, setLead] = useState<Lead | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const { lead } = await api.lead(id)
      setLead(lead)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lead')
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function generate() {
    if (!id || !notes.trim()) return
    setGenerating(true)
    setError('')
    // Generation runs as a Netlify background function (the LLM call takes
    // 30-50s, longer than a synchronous function allows). Fire it, then poll
    // the lead until a proposal newer than the ones we already know appears.
    const known = new Set((lead?.proposals ?? []).map((p) => p.id))
    try {
      await api.startProposalGeneration(id, notes)
      const deadline = Date.now() + 150_000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        const { lead: fresh } = await api.lead(id)
        const arrived = (fresh.proposals ?? []).find((p) => !known.has(p.id))
        if (arrived) {
          navigate(`/proposals/${arrived.id}`)
          return
        }
      }
      setError(
        'Generation is taking longer than expected. Give it a moment and refresh — the draft will appear under proposals for this lead.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    }
    setGenerating(false)
  }

  if (!lead && !error) return <Spinner label="loading lead…" />
  if (!lead) return <ErrorNote message={error} />

  return (
    <div className="space-y-6">
      <Link to="/" className="font-mono text-xs text-fog hover:text-bone">
        ← pipeline
      </Link>

      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight">{lead.name}</h1>
            <Badge {...LEAD_STATUS[lead.status]} />
          </div>
          <div className="mt-2 space-y-0.5 text-sm text-fog">
            <div>{lead.project_type ?? 'Project type unknown'}</div>
            <div className="font-mono text-xs">
              {[lead.email, lead.phone, lead.address].filter(Boolean).join(' · ') || 'No contact details'}
            </div>
            <div className="font-mono text-xs">
              via {SOURCE_LABEL[lead.source] ?? lead.source} · budget {lead.budget_range ?? 'unknown'}
            </div>
          </div>
        </div>
      </div>

      {(lead.proposals?.length ?? 0) > 0 && (
        <Panel className="rise rise-1 overflow-hidden">
          <div className="border-b border-edge px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fog">
            Proposals for this lead
          </div>
          <ul className="divide-y divide-edge">
            {lead.proposals!.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/proposals/${p.id}`}
                  className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-panel2"
                >
                  <div className="flex items-center gap-3">
                    <Badge {...PROPOSAL_STATUS[p.status]} />
                    <span className="font-mono text-xs text-fog">{shortDate(p.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm">{money(p.total)}</span>
                    <span className="text-fog">→</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="rise rise-2 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Site-walk notes → draft proposal</h2>
            <p className="text-xs text-fog">
              Paste raw notes. Claude prices them against the 60-item catalog; you review before
              anything reaches the client.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_NOTES.map((s) => (
              <button
                key={s.label}
                onClick={() => setNotes(s.text)}
                className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  s.kind === 'garbage'
                    ? 'border-alert/40 text-alert hover:bg-alert/10'
                    : 'border-edge2 text-fog hover:border-fog hover:text-bone'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={10}
          placeholder={'e.g.\nTear out 600 sqft old concrete patio…\n550 sqft travertine pavers…\n16x12 cedar pergola, fan pre-wire…'}
          className="w-full resize-y rounded-lg border border-edge bg-ink p-4 font-mono text-sm leading-relaxed text-bone outline-none transition-colors placeholder:text-fog/50 focus:border-terra"
        />

        {error && <div className="mt-3"><ErrorNote message={error} /></div>}

        <div className="mt-4 flex items-center justify-between">
          <div className="font-mono text-[11px] text-fog">
            model: claude-sonnet-4-6 · ~$0.03/proposal · flagged items require human sign-off
          </div>
          <Button onClick={generate} disabled={generating || !notes.trim()}>
            {generating ? <Spinner label="Claude is pricing the scope… ~30-60s" /> : 'Generate draft proposal'}
          </Button>
        </div>
      </Panel>
    </div>
  )
}
