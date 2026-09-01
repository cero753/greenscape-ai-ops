import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ClosedLostLead } from '../lib/types'
import { CLOSED_LOST_STATUS, money, shortDate } from '../lib/format'
import { Badge, Button, ErrorNote, Panel, Spinner } from '../components/ui'

/**
 * Stretch module UI: Closed-Lost Reactivation (strategy agent #3).
 * 1,400 dormant quotes ≈ $784K latent pipeline. Claude drafts Marcus-voiced
 * SMS messages; every one passes through this human approval queue.
 */
export default function Reactivation() {
  const [leads, setLeads] = useState<ClosedLostLead[] | null>(null)
  const [error, setError] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [busyDraft, setBusyDraft] = useState<string | null>(null)
  const pollTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const { leads } = await api.reactivation()
      setLeads(leads)
      return leads
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load closed-lost leads')
      return null
    }
  }, [])

  useEffect(() => {
    load()
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current)
    }
  }, [load])

  async function generateBatch() {
    setDrafting(true)
    setError('')
    try {
      // Background function: 202 now, drafts land in the DB in ~10-25s.
      await api.startReactivationDrafts()
      const deadline = Date.now() + 120_000
      const poll = async () => {
        const fresh = await load()
        const stillDrafting = fresh?.some((l) => l.status === 'drafting')
        if (stillDrafting && Date.now() < deadline) {
          pollTimer.current = window.setTimeout(poll, 3000)
        } else {
          setDrafting(false)
          if (stillDrafting) {
            setError('Drafting is taking longer than expected — refresh in a moment.')
          }
        }
      }
      pollTimer.current = window.setTimeout(poll, 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Draft generation failed')
      setDrafting(false)
    }
  }

  async function actOnDraft(draftId: string, action: 'send' | 'reject') {
    setBusyDraft(draftId)
    setError('')
    try {
      if (action === 'send') await api.sendReactivationDraft(draftId)
      else await api.rejectReactivationDraft(draftId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action} draft`)
    }
    setBusyDraft(null)
  }

  if (!leads && !error) return <Spinner label="loading closed-lost pipeline…" />

  const untouched = leads?.filter((l) => l.status === 'untouched').length ?? 0
  const pendingDrafts =
    leads?.flatMap((l) => l.outreach_drafts).filter((d) => d.status === 'pending_review').length ?? 0
  const latent = (leads ?? []).reduce((sum, l) => sum + (l.quoted_amount ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Closed-lost <span className="text-terra">reactivation</span>
          </h1>
          <p className="mt-1 max-w-xl text-sm text-fog">
            Old quotes that never closed. Claude drafts a personal SMS in Marcus's voice for each —
            nothing sends without your approval.
          </p>
        </div>
        <Button onClick={generateBatch} disabled={drafting || untouched === 0}>
          {drafting ? (
            <Spinner label="Claude is drafting…" />
          ) : untouched === 0 ? (
            'No untouched leads'
          ) : (
            `Draft next batch (${Math.min(untouched, 5)})`
          )}
        </Button>
      </div>

      <div className="rise rise-1 grid grid-cols-3 gap-3">
        {[
          { label: 'Dormant quotes here', value: String(leads?.length ?? 0) },
          { label: 'Latent pipeline', value: money(latent) },
          { label: 'Drafts awaiting review', value: String(pendingDrafts) },
        ].map((s) => (
          <Panel key={s.label} className="px-5 py-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fog">{s.label}</div>
            <div className="mt-1 font-display text-2xl font-bold">{s.value}</div>
          </Panel>
        ))}
      </div>

      {error && <ErrorNote message={error} />}

      <div className="rise rise-2 space-y-4">
        {(leads ?? []).map((lead) => (
          <Panel key={lead.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="font-display text-base font-bold">{lead.name}</span>
                <Badge {...CLOSED_LOST_STATUS[lead.status]} />
              </div>
              <div className="font-mono text-xs text-fog">
                quoted {money(lead.quoted_amount)} · last contact {shortDate(lead.last_contact_date)}
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="text-sm text-fog">
                <span className="text-bone">{lead.project_type ?? 'Unknown project'}</span>
                {lead.lost_reason && <span> · lost: {lead.lost_reason}</span>}
              </div>
              {lead.ghl_notes && (
                <div className="rounded-lg border border-edge bg-ink px-4 py-2.5 font-mono text-xs leading-relaxed text-fog">
                  GHL: {lead.ghl_notes}
                </div>
              )}

              {lead.outreach_drafts.map((draft) => (
                <div
                  key={draft.id}
                  className={`rounded-lg border px-4 py-3 ${
                    draft.status === 'rejected'
                      ? 'border-edge bg-panel opacity-50'
                      : draft.status === 'sent'
                        ? 'border-cactus/40 bg-cactus/5'
                        : 'border-sun/40 bg-sun/5'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-fog">
                    <span>
                      {draft.channel} draft · {draft.status.replace('_', ' ')}
                    </span>
                    <span>{draft.message.length} chars</span>
                  </div>
                  <p className="text-sm leading-relaxed">{draft.message}</p>
                  {draft.status === 'pending_review' && (
                    <div className="mt-3 flex gap-2">
                      <Button
                        onClick={() => actOnDraft(draft.id, 'send')}
                        disabled={busyDraft === draft.id}
                        className="!px-3 !py-1.5 !text-xs"
                      >
                        Approve & send SMS
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => actOnDraft(draft.id, 'reject')}
                        disabled={busyDraft === draft.id}
                        className="!px-3 !py-1.5 !text-xs"
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  )
}
