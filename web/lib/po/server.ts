import { createServiceClient } from '@/lib/supabase/server'
import type {
  OpenPoListRow,
  PoDetailRow,
  PoHeaderRow,
  PoLookupResult,
  PoReceivingSummaryRow,
  PoSearchRow,
} from './types'

export interface SubmissionImageRecord {
  id: string
  po_number: string
  image_url: string
  image_urls: string[] | null
  submitted_username: string
  branch: string | null
  status: string
  notes: string | null
  reviewer_notes: string | null
  created_at: string
}

export interface OpenPoSubmissionSummary {
  count: number
  latestSubmissionAt: string | null
  latestSubmissionId: string | null
  latestImageUrl: string | null
}

function isMissingReadModel(error: any) {
  const message = String(error?.message || '')
  return (
    message.includes('relation') ||
    message.includes('Could not find the table') ||
    message.includes('does not exist')
  )
}

function isOpenStatus(status: string | null | undefined) {
  if (!status) return true

  const normalized = status.trim().toLowerCase()
  if (!normalized) return true

  return ![
    'closed',
    'complete',
    'completed',
    'cancel',
    'cancelled',
    'canceled',
    'void',
    'voided',
    'received',
  ].some(token => normalized.includes(token))
}

export async function searchPurchaseOrders(query: string, limit = 10): Promise<PoSearchRow[]> {
  const supabase = createServiceClient()
  const normalized = query.trim()

  let request = supabase
    .from('app_po_search')
    .select('*')
    .order('synced_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (normalized) {
    request = request.or(
      `po_number.ilike.%${normalized}%,supplier_name.ilike.%${normalized}%,reference.ilike.%${normalized}%`
    )
  }

  const { data, error } = await request
  if (error) {
    if (isMissingReadModel(error)) {
      throw new Error('Shared PO read-model views are not available in Supabase yet.')
    }
    throw error
  }

  return (data || []) as PoSearchRow[]
}

export async function listOpenPurchaseOrdersForBranch(
  branchCode: string,
  limit = 100
): Promise<OpenPoListRow[]> {
  const supabase = createServiceClient()
  const normalized = branchCode.trim()

  if (!normalized) {
    return []
  }

  const { data, error } = await supabase.rpc('get_branch_open_pos', {
    branch_id: normalized,
    row_limit: limit * 5, // over-fetch because JS status filter runs after
  })

  if (error) throw error

  return ((data || []) as OpenPoListRow[])
    .filter(row => isOpenStatus(row.po_status) && isOpenStatus(row.wms_status))
    .slice(0, limit)
}

export async function getPurchaseOrder(poNumber: string): Promise<PoLookupResult | null> {
  const supabase = createServiceClient()
  const normalized = poNumber.trim()

  // get_po_detail currently accepts only numeric po_id filters.
  if (!/^\d+$/.test(normalized)) {
    return null
  }

  const { data, error } = await supabase.rpc('get_po_detail', {
    filter_col: 'po_id',
    filter_val: normalized,
  })

  if (error) {
    if (isMissingReadModel(error)) {
      throw new Error('Shared PO read-model views are not available in Supabase yet.')
    }
    throw error
  }

  const header = data?.header ?? null
  const detail = data?.lines ?? []
  const receiving = data?.receiving_summary ?? null

  if (!header) {
    return null
  }

  return {
    header: header as PoHeaderRow,
    detail: (detail || []) as PoDetailRow[],
    receiving: (receiving || null) as PoReceivingSummaryRow | null,
  }
}

export async function getSubmissionSummariesForPurchaseOrders(
  poNumbers: string[]
): Promise<Record<string, OpenPoSubmissionSummary>> {
  const normalized = Array.from(
    new Set(poNumbers.map(value => value.trim()).filter(Boolean))
  )
  if (normalized.length === 0) {
    return {}
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('submissions')
    .select('id, po_number, image_url, created_at')
    .in('po_number', normalized)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return (data || []).reduce<Record<string, OpenPoSubmissionSummary>>((acc, row: any) => {
    if (!acc[row.po_number]) {
      acc[row.po_number] = {
        count: 0,
        latestSubmissionAt: row.created_at || null,
        latestSubmissionId: row.id || null,
        latestImageUrl: row.image_url || null,
      }
    }

    acc[row.po_number].count += 1
    return acc
  }, {})
}

export async function getPurchaseOrderSubmissions(
  poNumber: string,
  branchCode?: string | null
): Promise<SubmissionImageRecord[]> {
  const supabase = createServiceClient()
  const normalizedPoNumber = poNumber.trim()
  const normalizedBranch = branchCode?.trim().toUpperCase()

  let query = supabase
    .from('submissions')
    .select(
      'id, po_number, image_url, image_urls, submitted_username, branch, status, notes, reviewer_notes, created_at'
    )
    .eq('po_number', normalizedPoNumber)
    .order('created_at', { ascending: false })

  if (normalizedBranch) {
    query = query.eq('branch', normalizedBranch)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data || []) as SubmissionImageRecord[]
}
