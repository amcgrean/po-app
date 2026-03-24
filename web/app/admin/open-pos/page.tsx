import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { getSubmissionSummariesForPurchaseOrders } from '@/lib/po/server'
import { formatDate } from '@/lib/utils'
import type { PoSearchRow } from '@/lib/po/types'

export const dynamic = 'force-dynamic'

function formatCurrency(value: number | null) {
  if (value == null) return '—'
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function isOpenStatus(status: string | null | undefined) {
  if (!status) return true
  const normalized = status.trim().toLowerCase()
  if (!normalized) return true
  return !['closed', 'complete', 'completed', 'cancel', 'cancelled', 'canceled', 'void', 'voided', 'received'].some(
    token => normalized.includes(token)
  )
}

async function listAllOpenPurchaseOrders(limit = 200): Promise<PoSearchRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('app_po_search')
    .select('*')
    .order('expect_date', { ascending: true, nullsFirst: false })
    .order('order_date', { ascending: false, nullsFirst: false })
    .limit(limit * 3)

  if (error) throw error

  return ((data || []) as PoSearchRow[])
    .filter(row => isOpenStatus(row.po_status) && isOpenStatus(row.wms_status))
    .slice(0, limit)
}

export default async function AdminOpenPosPage() {
  let openPOs: PoSearchRow[] = []
  let submissionSummaries: Awaited<ReturnType<typeof getSubmissionSummariesForPurchaseOrders>> = {}
  let loadError: string | null = null

  try {
    openPOs = await listAllOpenPurchaseOrders(200)
    submissionSummaries = await getSubmissionSummariesForPurchaseOrders(
      openPOs.map(row => row.po_number)
    )
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Open PO data could not be loaded.'
  }

  // Build unique branch list for the summary
  const branches = Array.from(new Set(openPOs.map(r => r.system_id).filter(Boolean))).sort() as string[]
  const withImagesCount = openPOs.filter(row => (submissionSummaries[row.po_number]?.count || 0) > 0).length

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-green-700">All Branches</p>
        <h1 className="text-3xl font-bold text-gray-900">Open Purchase Orders</h1>
        <p className="mt-1 text-sm text-gray-500">
          ERP mirror data across all branches. Showing up to 200 open POs.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          <p className="font-semibold">Open POs could not be loaded.</p>
          <p className="mt-1">{loadError}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-red-800">
            <li>Confirm SUPABASE_SERVICE_ROLE_KEY is set server-side.</li>
            <li>Confirm app_po_* shared read-model views exist in Supabase.</li>
          </ul>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Open POs</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{openPOs.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">With images</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{withImagesCount}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Awaiting images</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{Math.max(openPOs.length - withImagesCount, 0)}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Branches</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{branches.length}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {openPOs.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-500">
                <div className="mb-3 text-4xl">📭</div>
                <p className="font-medium">No open purchase orders found in the ERP mirror.</p>
                <p className="mt-1 text-sm text-gray-400">
                  Verify that ERP mirror data is synced and app_po_* views exist in Supabase.
                </p>
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-[1fr_0.6fr_0.7fr_0.7fr_0.9fr_0.9fr_52px] gap-4 border-b border-gray-100 bg-gray-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid">
                  <span>PO / Supplier</span>
                  <span>Branch</span>
                  <span>Status</span>
                  <span>Expected</span>
                  <span>Total</span>
                  <span>Images</span>
                  <span></span>
                </div>
                <div className="divide-y divide-gray-100">
                  {openPOs.map(row => {
                    const summary = submissionSummaries[row.po_number]
                    const hasImages = (summary?.count || 0) > 0

                    return (
                      <Link
                        key={row.po_number}
                        href={`/supervisor/open-pos/${encodeURIComponent(row.po_number)}`}
                        className="grid gap-3 px-5 py-4 transition-colors hover:bg-gray-50 md:grid-cols-[1fr_0.6fr_0.7fr_0.7fr_0.9fr_0.9fr_52px] md:items-center"
                      >
                        <div>
                          <p className="text-lg font-bold text-gray-900">{row.po_number}</p>
                          <p className="text-sm text-gray-500">{row.supplier_name || 'Supplier unavailable'}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-400 md:hidden">Branch</p>
                          <p className="text-sm font-medium text-gray-800">{row.system_id || '—'}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-400 md:hidden">Status</p>
                          <p className="text-sm text-gray-700">{row.po_status || row.wms_status || 'Open'}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-400 md:hidden">Expected</p>
                          <p className="text-sm text-gray-700">
                            {row.expect_date ? formatDate(row.expect_date) : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-400 md:hidden">Total</p>
                          <p className="text-sm text-gray-700">{formatCurrency(row.po_total)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-400 md:hidden">Images</p>
                          <div className="flex items-center gap-3">
                            {summary?.latestImageUrl ? (
                              <img
                                src={summary.latestImageUrl}
                                alt="Latest submission"
                                className="h-10 w-10 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400">
                                —
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-medium text-gray-800">
                                {summary?.count || 0} submission{summary?.count === 1 ? '' : 's'}
                              </p>
                              <p className={`text-xs ${hasImages ? 'text-green-700' : 'text-gray-400'}`}>
                                {hasImages ? 'Images available' : 'No images yet'}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="hidden text-right text-gray-300 md:block">→</div>
                      </Link>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
