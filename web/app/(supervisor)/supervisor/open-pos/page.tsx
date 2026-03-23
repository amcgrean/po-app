import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  getSubmissionSummariesForPurchaseOrders,
  listOpenPurchaseOrdersForBranch,
} from '@/lib/po/server'
import { formatDate } from '@/lib/utils'

function formatCurrency(value: number | null) {
  if (value == null) return '—'
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

export const dynamic = 'force-dynamic'

export default async function SupervisorOpenPoPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('role, branch, display_name, username')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null }

  const branch = profile?.branch?.trim().toUpperCase() || ''
  const displayName = profile?.display_name || profile?.username || 'Supervisor'

  const openPurchaseOrders = branch
    ? await listOpenPurchaseOrdersForBranch(branch, 150)
    : []
  const submissionSummaries = await getSubmissionSummariesForPurchaseOrders(
    openPurchaseOrders.map(row => row.po_number)
  )

  const withImagesCount = openPurchaseOrders.filter(
    row => (submissionSummaries[row.po_number]?.count || 0) > 0
  ).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-green-700">Branch Open POs</p>
          <h1 className="text-3xl font-bold text-gray-900">
            {branch ? `${branch} Open Purchase Orders` : 'Open Purchase Orders'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Live ERP mirror data for {displayName}
            {branch ? ` • branch ${branch}` : ''}. Select a PO to see header details, line items,
            receipts, and any submitted images.
          </p>
        </div>
        <Link
          href="/supervisor"
          className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back to dashboard
        </Link>
      </div>

      {!branch ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Your user profile does not have a branch code yet, so branch-scoped open POs cannot be listed.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Open POs</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{openPurchaseOrders.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">With submitted images</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{withImagesCount}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Awaiting images</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {Math.max(openPurchaseOrders.length - withImagesCount, 0)}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {openPurchaseOrders.length === 0 ? (
              <div className="px-6 py-16 text-center text-gray-500">
                <div className="mb-3 text-4xl">📭</div>
                <p className="font-medium">No open purchase orders were found for branch {branch}.</p>
                <p className="mt-1 text-sm text-gray-400">
                  If you expect results, verify that the shared Supabase ERP mirror views are current.
                </p>
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-[1.2fr_0.7fr_0.7fr_0.9fr_0.9fr_56px] gap-4 border-b border-gray-100 bg-gray-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid">
                  <span>PO / Supplier</span>
                  <span>Status</span>
                  <span>Expected</span>
                  <span>Total</span>
                  <span>Images</span>
                  <span></span>
                </div>
                <div className="divide-y divide-gray-100">
                  {openPurchaseOrders.map(row => {
                    const summary = submissionSummaries[row.po_number]
                    const hasImages = (summary?.count || 0) > 0

                    return (
                      <Link
                        key={row.po_number}
                        href={`/supervisor/open-pos/${encodeURIComponent(row.po_number)}`}
                        className="grid gap-3 px-5 py-4 transition-colors hover:bg-gray-50 md:grid-cols-[1.2fr_0.7fr_0.7fr_0.9fr_0.9fr_56px] md:items-center"
                      >
                        <div>
                          <p className="text-lg font-bold text-gray-900">{row.po_number}</p>
                          <p className="text-sm text-gray-500">{row.supplier_name || 'Supplier unavailable'}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-400 md:hidden">Status</p>
                          <p className="text-sm font-medium text-gray-800">{row.po_status || row.wms_status || 'Open'}</p>
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
