import { createServiceClient } from '@/lib/supabase/server'
import type {
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
): Promise<PoSearchRow[]> {
  const supabase = createServiceClient()
  const normalized = branchCode.trim().toUpperCase()

  if (!normalized) {
    return []
  }

  const fetchLimit = Math.min(Math.max(limit * 3, 100), 300)

  const { data, error } = await supabase
    .from('app_po_search')
    .select('*')
    .eq('branch_code', normalized)
    .order('expect_date', { ascending: true, nullsFirst: false })
    .order('order_date', { ascending: false, nullsFirst: false })
    .limit(fetchLimit)

  if (error) {
    if (isMissingReadModel(error)) {
      throw new Error('Shared PO read-model views are not available in Supabase yet.')
    }
    throw error
  }

  return ((data || []) as PoSearchRow[])
    .filter(row => isOpenStatus(row.po_status) && isOpenStatus(row.wms_status))
    .slice(0, limit)
}

export async function getPurchaseOrder(poNumber: string): Promise<PoLookupResult | null> {
  const supabase = createServiceClient()
  const normalized = poNumber.trim()

  // The erp_mirror_* tables only have po_id (integer); the app_po_* views
  // derive po_number from it. Querying by the integer po_id lets the
  // planner use our idx_erp_mirror_*_po_id indexes instead of doing a
  // full table scan through the po_number expression.
  const poIdMatch = /^\d+$/.exec(normalized)
  const filterCol = poIdMatch ? 'po_id' : 'po_number'
  const filterVal = poIdMatch ? parseInt(normalized, 10) : normalized

  const [{ data: header, error: headerError }, { data: detail, error: detailError }, { data: receiving, error: receivingError }] =
    await Promise.all([
      supabase.from('app_po_header').select('*').eq(filterCol, filterVal).limit(1).maybeSingle(),
      supabase.from('app_po_detail').select('*').eq(filterCol, filterVal).order('line_number', { ascending: true }),
      supabase.from('app_po_receiving_summary').select('*').eq(filterCol, filterVal).limit(1).maybeSingle(),
    ])

  const firstError = headerError || detailError || receivingError
  if (firstError) {
    if (isMissingReadModel(firstError)) {
      throw new Error('Shared PO read-model views are not available in Supabase yet.')
    }
    throw firstError
  }

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
