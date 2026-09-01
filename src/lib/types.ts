export type LeadStatus = 'new' | 'qualified' | 'site_walk_done' | 'proposal_sent' | 'won' | 'lost'
export type ProposalStatus =
  | 'draft'
  | 'needs_clarification'
  | 'pending_review'
  | 'approved'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'declined'

export interface Lead {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  source: string
  project_type: string | null
  budget_range: string | null
  status: LeadStatus
  created_at: string
  proposals?: ProposalSummary[]
}

export interface ProposalSummary {
  id: string
  status: ProposalStatus
  total: number
  generation_cost_usd?: number
  created_at: string
  sent_at?: string | null
  accepted_at?: string | null
}

export interface LineItem {
  id?: string
  proposal_id?: string
  catalog_item_id: string | null
  description: string
  qty: number
  unit: string
  unit_price: number
  line_total: number
  confidence: number
  needs_review: boolean
  review_reason: string | null
  sort_order: number
}

export interface Proposal {
  id: string
  lead_id: string
  status: ProposalStatus
  site_walk_notes: string
  scope_summary: string | null
  client_note: string | null
  clarification_reason: string | null
  subtotal: number
  total: number
  deposit_amount: number | null
  client_token: string
  ai_model: string | null
  input_tokens: number | null
  output_tokens: number | null
  generation_cost_usd: number | null
  ai_warnings: string[] | null
  created_at: string
  sent_at: string | null
  accepted_at: string | null
  proposal_line_items: LineItem[]
  leads?: Lead
}

export interface CatalogItem {
  id: string
  code: string
  category: string
  item_name: string
  unit: string
  unit_price: number
  min_price: number
  max_price: number
  notes: string | null
}

export type ClosedLostStatus =
  | 'untouched'
  | 'drafting'
  | 'draft_ready'
  | 'approved'
  | 'sent'
  | 'responded'
  | 'reactivated'
  | 'opted_out'

export interface OutreachDraft {
  id: string
  closed_lost_lead_id: string
  channel: 'sms' | 'email'
  message: string
  status: 'pending_review' | 'approved' | 'sent' | 'rejected'
  ai_model: string | null
  generation_cost_usd: number | null
  sent_at: string | null
  created_at: string
}

export interface ClosedLostLead {
  id: string
  name: string
  phone: string | null
  email: string | null
  project_type: string | null
  quoted_amount: number | null
  lost_reason: string | null
  last_contact_date: string | null
  ghl_notes: string | null
  status: ClosedLostStatus
  created_at: string
  outreach_drafts: OutreachDraft[]
}

export interface ClientProposal {
  id: string
  status: ProposalStatus
  scope_summary: string | null
  client_note: string | null
  subtotal: number
  total: number
  deposit_amount: number | null
  sent_at: string | null
  accepted_at: string | null
  proposal_line_items: Pick<LineItem, 'description' | 'qty' | 'unit' | 'unit_price' | 'line_total' | 'sort_order'>[]
  leads: { name: string; address: string | null } | null
}
