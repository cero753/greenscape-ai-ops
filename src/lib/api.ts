import type { CatalogItem, ClientProposal, Lead, LineItem, Proposal } from './types'

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

  generateProposal: (lead_id: string, site_walk_notes: string) =>
    request<{ proposal: Proposal; line_items: LineItem[] }>('/api/generate-proposal', {
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
}
