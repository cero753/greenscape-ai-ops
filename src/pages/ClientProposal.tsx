import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { ClientProposal } from '../lib/types'
import { money } from '../lib/format'

/**
 * Public client-facing proposal — deliberately NOT the admin aesthetic.
 * Warm paper, Fraunces serif: the client receives a premium design-build
 * proposal, not a screenshot of a SaaS tool.
 */
export default function ClientProposalPage() {
  const { token } = useParams<{ token: string }>()
  const [proposal, setProposal] = useState<ClientProposal | null>(null)
  const [error, setError] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [justAccepted, setJustAccepted] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const { proposal } = await api.clientProposal(token)
      setProposal(proposal)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Proposal not found')
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  async function accept() {
    if (!token) return
    setAccepting(true)
    try {
      await api.acceptProposal(token)
      setJustAccepted(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setAccepting(false)
    }
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper font-serif text-inkwarm">
        <div className="text-center">
          <div className="text-4xl">🌵</div>
          <p className="mt-4 text-lg italic">This proposal link isn't valid or hasn't been sent yet.</p>
        </div>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper font-serif italic text-inkwarm/60">
        Preparing your proposal…
      </div>
    )
  }

  const accepted = proposal.status === 'accepted'

  return (
    <div className="min-h-screen bg-paper font-serif text-inkwarm">
      {/* masthead */}
      <div className="border-b-2 border-inkwarm/80">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="flex items-end justify-between">
            <div>
              <div className="font-display text-xs font-semibold uppercase tracking-[0.35em] text-terra-deep">
                Design · Build · Phoenix
              </div>
              <h1 className="mt-2 text-5xl font-light tracking-tight">
                Greenscape <span className="italic">Pro</span>
              </h1>
            </div>
            <div className="text-right font-display text-xs uppercase tracking-[0.2em] text-inkwarm/60">
              Project proposal
              {proposal.sent_at && (
                <div className="mt-1">
                  {new Date(proposal.sent_at).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* prepared for */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="font-display text-[10px] uppercase tracking-[0.3em] text-inkwarm/50">
              Prepared for
            </div>
            <div className="mt-1 text-2xl">{proposal.leads?.name}</div>
            {proposal.leads?.address && (
              <div className="text-sm italic text-inkwarm/60">{proposal.leads.address}</div>
            )}
          </div>
          <div className="text-right">
            <div className="font-display text-[10px] uppercase tracking-[0.3em] text-inkwarm/50">
              Investment
            </div>
            <div className="mt-1 text-3xl font-medium text-terra-deep">{money(proposal.total)}</div>
          </div>
        </div>

        {/* scope */}
        {proposal.scope_summary && (
          <div className="mt-10">
            <div className="font-display text-[10px] uppercase tracking-[0.3em] text-inkwarm/50">
              Your project
            </div>
            <p className="mt-3 text-lg leading-relaxed">{proposal.scope_summary}</p>
            {proposal.client_note && (
              <p className="mt-3 border-l-2 border-terra-deep/40 pl-4 italic text-inkwarm/70">
                {proposal.client_note}
              </p>
            )}
          </div>
        )}

        {/* line items */}
        <div className="mt-10">
          <div className="font-display text-[10px] uppercase tracking-[0.3em] text-inkwarm/50">
            Scope of work
          </div>
          <table className="mt-3 w-full">
            <tbody>
              {proposal.proposal_line_items.map((li, i) => (
                <tr key={i} className="border-b border-sand">
                  <td className="py-3 pr-4">{li.description}</td>
                  <td className="whitespace-nowrap py-3 pr-4 text-right font-display text-xs text-inkwarm/50">
                    {li.qty.toLocaleString()} {li.unit}
                  </td>
                  <td className="whitespace-nowrap py-3 text-right font-medium">
                    {money(li.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="py-4 text-right font-display text-xs uppercase tracking-[0.2em] text-inkwarm/60">
                  Total investment
                </td>
                <td className="py-4 text-right text-2xl font-medium text-terra-deep">
                  {money(proposal.total)}
                </td>
              </tr>
            </tfoot>
          </table>
          {proposal.deposit_amount != null && proposal.deposit_amount > 0 && (
            <p className="text-sm italic text-inkwarm/60">
              A 50% deposit ({money(proposal.deposit_amount)}) secures your place on our build
              calendar. Balance due on completion.
            </p>
          )}
        </div>

        {/* accept */}
        <div className="mt-12 rounded-xl bg-paper2 p-8 text-center">
          {accepted ? (
            <>
              <div className="text-4xl">{justAccepted ? '🎉' : '✓'}</div>
              <h2 className="mt-3 text-2xl">
                {justAccepted ? 'Wonderful — welcome aboard!' : 'Proposal accepted'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm italic text-inkwarm/70">
                Marcus and the team have been notified. You'll receive the deposit invoice and your
                project kickoff details shortly.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl">Ready to transform your outdoors?</h2>
              <p className="mx-auto mt-2 max-w-md text-sm italic text-inkwarm/70">
                Accepting reserves your spot on our schedule. We'll follow up within one business
                day with next steps.
              </p>
              <button
                onClick={accept}
                disabled={accepting}
                className="mt-6 rounded-full bg-inkwarm px-10 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.15em] text-paper transition-all hover:bg-terra-deep disabled:opacity-50"
              >
                {accepting ? 'One moment…' : 'Accept proposal'}
              </button>
            </>
          )}
        </div>

        <footer className="mt-10 border-t border-sand pt-6 text-center font-display text-[10px] uppercase tracking-[0.25em] text-inkwarm/40">
          Greenscape Pro · Licensed & bonded · ROC #123456 · Phoenix, Arizona
        </footer>
      </div>
    </div>
  )
}
