import type { CatalogItem, ClientProposal, ClosedLostLead, Lead, LineItem, OutreachDraft, Proposal } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`)
  }
  return data as T
}

export const api = {
  leads: () => request<{ leads: Lead[] }>('/api/leads'),
  lead: (id: string) => request<{ lead: Lead }>(`/api/leads?id=${id}`),
  catalog: () => request<{ items: CatalogItem[] }>('/api/catalog'),

  simulateLead: (payload: Record<string, string>) =>
    request<{ lead: Lead }>('/api/ghl-webhook', { method: 'POST', body: JSON.stringify(payload) }),

  // Netlify background function: answers 202 immediately, Claude keeps
  // working server-side. The caller polls `lead()` until the draft appears.
  startProposalGeneration: (lead_id: string, site_walk_notes: string) =>
    request<null>('/api/generate-proposal-background', {
      method: 'POST',
      body: JSON.stringify({ lead_id, site_walk_notes }),
    }),

  proposal: (id: string) => request<{ proposal: Proposal }>(`/api/proposal?id=${id}`),

  saveProposal: (
    id: string,
    body: { scope_summary?: string; client_note?: string; line_items?: Partial<LineItem>[] },
  ) =>
    request<{ proposal: Proposal }>(`/api/proposal?id=${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  approveSend: (id: string) =>
    request<{ proposal: Proposal; client_url: string }>(
      `/api/proposal?id=${id}&action=approve-send`,
      { method: 'POST' },
    ),

  clientProposal: (token: string) =>
    request<{ proposal: ClientProposal }>(`/api/client-proposal?token=${token}`),

  acceptProposal: (token: string) =>
    request<{ proposal: ClientProposal; deposit_due: number }>(
      `/api/client-proposal?token=${token}&action=accept`,
      { method: 'POST' },
    ),

  reactivation: () => request<{ leads: ClosedLostLead[] }>('/api/reactivation'),

  // Pipeline Q&A agent: POST records the question and kicks a background
  // Claude tool-use loop (202 + query_id); poll askStatus until answered.
  askPipeline: (question: string) =>
    request<{ query_id: string }>('/api/slack-ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  askStatus: (id: string) =>
    request<{
      id: string
      question: string
      answer: string | null
      status: 'running' | 'answered' | 'failed'
      generation_cost_usd: number | null
    }>(`/api/slack-ask?id=${id}`),

  // Background function (202): poll `reactivation()` for `drafting` -> `draft_ready`.
  startReactivationDrafts: (lead_ids?: string[]) =>
    request<null>('/api/reactivation-generate-background', {
      method: 'POST',
      body: JSON.stringify({ lead_ids }),
    }),

  sendReactivationDraft: (draft_id: string) =>
    request<{ draft: OutreachDraft }>('/api/reactivation', {
      method: 'POST',
      body: JSON.stringify({ action: 'send', draft_id }),
    }),

  rejectReactivationDraft: (draft_id: string) =>
    request<{ ok: boolean }>('/api/reactivation', {
      method: 'POST',
      body: JSON.stringify({ action: 'reject', draft_id }),
    }),
}
