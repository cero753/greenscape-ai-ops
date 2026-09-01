import type { LeadStatus, ProposalStatus } from './types'

export function money(n: number | null | undefined, cents = false): string {
  if (n == null) return '$0'
  return (
    '$' +
    Number(n).toLocaleString('en-US', {
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    })
  )
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export const LEAD_STATUS: Record<LeadStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'text-sun border-sun/40 bg-sun/10' },
  qualified: { label: 'Qualified', cls: 'text-bone border-edge2 bg-panel2' },
  site_walk_done: { label: 'Site walk done', cls: 'text-terra border-terra/40 bg-terra/10' },
  proposal_sent: { label: 'Proposal out', cls: 'text-cactus border-cactus/40 bg-cactus/10' },
  won: { label: 'Won', cls: 'text-cactus border-cactus/60 bg-cactus/20' },
  lost: { label: 'Lost', cls: 'text-fog border-edge bg-panel' },
}

export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'text-fog border-edge bg-panel' },
  needs_clarification: { label: 'Needs clarification', cls: 'text-alert border-alert/40 bg-alert/10' },
  pending_review: { label: 'Pending review', cls: 'text-sun border-sun/40 bg-sun/10' },
  approved: { label: 'Approved', cls: 'text-cactus border-cactus/40 bg-cactus/10' },
  sent: { label: 'Sent', cls: 'text-terra border-terra/40 bg-terra/10' },
  viewed: { label: 'Viewed by client', cls: 'text-terra border-terra/60 bg-terra/15' },
  accepted: { label: 'Accepted 🎉', cls: 'text-cactus border-cactus/60 bg-cactus/20' },
  declined: { label: 'Declined', cls: 'text-fog border-edge bg-panel' },
}

export const SOURCE_LABEL: Record<string, string> = {
  meta: 'Meta ads',
  google_lsa: 'Google LSA',
  referral: 'Referral',
  manual: 'Manual',
}
