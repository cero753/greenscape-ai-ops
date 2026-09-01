import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { CatalogItem, LineItem, Proposal } from '../lib/types'
import { PROPOSAL_STATUS, money } from '../lib/format'
import { Badge, Button, ErrorNote, Panel, Spinner } from '../components/ui'

type EditableItem = LineItem & { _confirmed?: boolean }

export default function ProposalReview() {
  const { id } = useParams<{ id: string }>()
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [items, setItems] = useState<EditableItem[]>([])
  const [scope, setScope] = useState('')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [addCode, setAddCode] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [clientUrl, setClientUrl] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [{ proposal }, { items: cat }] = await Promise.all([api.proposal(id), api.catalog()])
      setProposal(proposal)
      setItems(proposal.proposal_line_items)
      setScope(proposal.scope_summary ?? '')
      setCatalog(cat)
      if (['sent', 'viewed', 'accepted'].includes(proposal.status)) {
        setClientUrl(`${window.location.origin}/p/${proposal.client_token}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load proposal')
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const editable = proposal ? ['pending_review', 'needs_clarification', 'approved'].includes(proposal.status) : false
  const subtotal = useMemo(
    () => items.reduce((s, li) => s + li.qty * li.unit_price, 0),
    [items],
  )
  const unresolved = items.filter((li) => li.needs_review && !li._confirmed).length

  function patchItem(i: number, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((li, j) => (j === i ? { ...li, ...patch } : li)))
    setDirty(true)
  }

  function addFromCatalog() {
    const cat = catalog.find((c) => c.code === addCode)
    if (!cat) return
    setItems((prev) => [
      ...prev,
      {
        catalog_item_id: cat.id,
        description: cat.item_name,
        qty: 1,
        unit: cat.unit,
        unit_price: Number(cat.unit_price),
        line_total: Number(cat.unit_price),
        confidence: 1,
        needs_review: false,
        review_reason: null,
        sort_order: prev.length,
      },
    ])
    setAddCode('')
    setDirty(true)
  }

  async function save(): Promise<boolean> {
    if (!id) return false
    setSaving(true)
    setError('')
    try {
      const { proposal: updated } = await api.saveProposal(id, {
        scope_summary: scope,
        line_items: items.map((li, i) => ({
          catalog_item_id: li.catalog_item_id,
          description: li.description,
          qty: li.qty,
          unit: li.unit,
          unit_price: li.unit_price,
          sort_order: i,
        })),
      })
      setProposal((p) => (p ? { ...p, ...updated, proposal_line_items: updated.proposal_line_items ?? p.proposal_line_items } : p))
      setItems(updated.proposal_line_items ?? [])
      setDirty(false)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function approveSend() {
    if (!id) return
    if (unresolved > 0) {
      setError(`${unresolved} flagged item(s) still need a decision — edit or confirm them first.`)
      return
    }
    setSending(true)
    setError('')
    // Any local edits (including confirmations of flagged lines) must be
    // persisted first — saving clears the flags server-side.
    if (dirty || items.some((li) => li.needs_review)) {
      const ok = await save()
      if (!ok) {
        setSending(false)
        return
      }
    }
    try {
      const { client_url } = await api.approveSend(id)
      const absolute = client_url.startsWith('http')
        ? client_url
        : `${window.location.origin}${client_url.replace(/^.*\/p\//, '/p/')}`
      setClientUrl(absolute)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  if (!proposal && !error) return <Spinner label="loading proposal…" />
  if (!proposal) return <ErrorNote message={error} />

  const status = PROPOSAL_STATUS[proposal.status]

  return (
    <div className="space-y-6">
      <Link to={`/leads/${proposal.lead_id}`} className="font-mono text-xs text-fog hover:text-bone">
        ← back to {proposal.leads?.name ?? 'lead'}
      </Link>

      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Proposal · {proposal.leads?.name}
            </h1>
            <Badge {...status} />
          </div>
          <div className="mt-1 font-mono text-[11px] text-fog">
            {proposal.ai_model ?? 'manual'} · {proposal.input_tokens ?? 0} in /{' '}
            {proposal.output_tokens ?? 0} out tokens · AI cost{' '}
            {proposal.generation_cost_usd != null && proposal.generation_cost_usd < 0.01
              ? '<$0.01'
              : money(proposal.generation_cost_usd, true)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">Total</div>
          <div className="font-display text-3xl font-bold text-terra">{money(subtotal)}</div>
          <div className="font-mono text-[11px] text-fog">50% deposit: {money(subtotal / 2)}</div>
        </div>
      </div>

      {proposal.status === 'needs_clarification' && (
        <Panel className="rise border-alert/40 bg-alert/5 p-5">
          <div className="font-display font-bold text-alert">⚠ AI declined to price this one</div>
          <p className="mt-1 text-sm text-bone/90">
            The notes weren't enough to quote from, so no numbers were invented. It needs:
          </p>
          <p className="mt-2 rounded-lg bg-ink/60 p-3 font-mono text-sm text-sun">
            {proposal.clarification_reason}
          </p>
          <p className="mt-2 text-xs text-fog">
            Fix the notes and regenerate from the lead page — or price it manually by adding
            catalog items below.
          </p>
        </Panel>
      )}

      {(proposal.ai_warnings?.length ?? 0) > 0 && proposal.status === 'pending_review' && (
        <Panel className="rise border-sun/40 bg-sun/5 p-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-sun">
            Guardrails flagged {proposal.ai_warnings!.length} item(s)
          </div>
          <ul className="mt-2 space-y-1 text-sm text-bone/90">
            {proposal.ai_warnings!.map((w, i) => (
              <li key={i} className="font-mono text-xs">· {w}</li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="rise rise-1 p-5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fog">
          Client-facing scope summary
        </div>
        <textarea
          value={scope}
          onChange={(e) => {
            setScope(e.target.value)
            setDirty(true)
          }}
          disabled={!editable}
          rows={3}
          className="w-full resize-y rounded-lg border border-edge bg-ink p-3 text-sm leading-relaxed text-bone outline-none focus:border-terra disabled:opacity-60"
        />
      </Panel>

      <Panel className="rise rise-2 overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">
            Line items
          </span>
          {unresolved > 0 && (
            <span className="font-mono text-[11px] text-sun">
              {unresolved} flagged — resolve before sending
            </span>
          )}
        </div>

        <div className="divide-y divide-edge">
          {items.map((li, i) => {
            const flagged = li.needs_review && !li._confirmed
            return (
              <div key={i} className={`px-5 py-3 ${flagged ? 'bg-sun/5' : ''}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    value={li.description}
                    disabled={!editable}
                    onChange={(e) => patchItem(i, { description: e.target.value })}
                    className="min-w-[200px] flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none transition-colors focus:border-edge2 focus:bg-ink disabled:opacity-60"
                  />
                  <input
                    type="number"
                    value={li.qty}
                    disabled={!editable}
                    min={0}
                    onChange={(e) => patchItem(i, { qty: Number(e.target.value) })}
                    className="w-20 rounded-md border border-edge bg-ink px-2 py-1 text-right font-mono text-sm outline-none focus:border-terra disabled:opacity-60"
                  />
                  <span className="w-10 font-mono text-xs text-fog">{li.unit}</span>
                  <span className="font-mono text-xs text-fog">×</span>
                  <input
                    type="number"
                    value={li.unit_price}
                    disabled={!editable}
                    min={0}
                    step="0.01"
                    onChange={(e) => patchItem(i, { unit_price: Number(e.target.value) })}
                    className="w-24 rounded-md border border-edge bg-ink px-2 py-1 text-right font-mono text-sm outline-none focus:border-terra disabled:opacity-60"
                  />
                  <span className="w-24 text-right font-mono text-sm">
                    {money(li.qty * li.unit_price)}
                  </span>
                  {editable && (
                    <button
                      onClick={() => {
                        setItems((prev) => prev.filter((_, j) => j !== i))
                        setDirty(true)
                      }}
                      className="text-fog transition-colors hover:text-alert"
                      title="Remove line"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {flagged && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-ink/60 px-3 py-2">
                    <span className="font-mono text-[11px] text-sun">⚠ {li.review_reason}</span>
                    <button
                      onClick={() => patchItem(i, { _confirmed: true })}
                      className="rounded border border-cactus/40 px-2 py-0.5 font-mono text-[11px] text-cactus hover:bg-cactus/10"
                    >
                      Looks right — confirm
                    </button>
                  </div>
                )}
                {!li.needs_review && li.confidence < 1 && (
                  <div className="mt-1 font-mono text-[10px] text-fog">
                    AI confidence {Math.round(li.confidence * 100)}%
                  </div>
                )}
              </div>
            )
          })}
          {items.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-fog">No line items yet.</div>
          )}
        </div>

        {editable && (
          <div className="flex flex-wrap items-center gap-3 border-t border-edge px-5 py-3">
            <select
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              className="max-w-md flex-1 rounded-md border border-edge bg-ink px-2 py-1.5 font-mono text-xs text-bone outline-none focus:border-terra"
            >
              <option value="">+ Add item from pricing catalog…</option>
              {catalog.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.item_name} ({money(c.unit_price)}/{c.unit})
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={addFromCatalog} disabled={!addCode}>
              Add
            </Button>
          </div>
        )}
      </Panel>

      {clientUrl && (
        <Panel className="rise border-cactus/40 bg-cactus/5 p-5">
          <div className="font-display font-bold text-cactus">
            {proposal.status === 'accepted' ? '🎉 Accepted by client' : 'Live client link'}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="rounded-md bg-ink/60 px-3 py-2 font-mono text-xs text-bone">{clientUrl}</code>
            <Button variant="ghost" onClick={() => navigator.clipboard.writeText(clientUrl)}>
              Copy
            </Button>
            <a href={clientUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-cactus hover:underline">
              Open as client ↗
            </a>
          </div>
        </Panel>
      )}

      {error && <ErrorNote message={error} />}

      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-3 pb-6">
          <Button variant="ghost" onClick={save} disabled={saving || !dirty}>
            {saving ? <Spinner label="saving…" /> : dirty ? 'Save changes' : 'Saved'}
          </Button>
          <Button onClick={approveSend} disabled={sending || unresolved > 0 || items.length === 0}>
            {sending ? <Spinner label="sending…" /> : `Approve & send ${money(subtotal)} proposal →`}
          </Button>
        </div>
      )}
    </div>
  )
}
