import { createServiceClient } from '@/lib/supabase/server'
import type {
  PoDetailRow,
  PoHeaderRow,
  PoLookupResult,
  PoReceivingSummaryRow,
  PoSearchRow,
} from './types'

function isMissingReadModel(error: any) {
  const message = String(error?.message || '')
  return (
    message.includes('relation') ||
    message.includes('Could not find the table') ||
    message.includes('does not exist')
  )
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

export async function getPurchaseOrder(poNumber: string): Promise<PoLookupResult | null> {
  const supabase = createServiceClient()
  const normalized = poNumber.trim()

  const [{ data: header, error: headerError }, { data: detail, error: detailError }, { data: receiving, error: receivingError }] =
    await Promise.all([
      supabase
        .from('app_po_header')
        .select('*')
        .eq('po_number', normalized)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('app_po_detail')
        .select('*')
        .eq('po_number', normalized)
        .order('line_number', { ascending: true }),
      supabase
        .from('app_po_receiving_summary')
        .select('*')
        .eq('po_number', normalized)
        .limit(1)
        .maybeSingle(),
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
