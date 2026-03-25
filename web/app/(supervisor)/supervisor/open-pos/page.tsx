import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  getSubmissionSummariesForPurchaseOrders,
  listOpenPurchaseOrdersForBranch,
} from '@/lib/po/server'
import type { OpenPoListRow } from '@/lib/po/types'
import { formatDate } from '@/lib/utils'

interface BranchDiagnostics {
  totalRowsInView: number | null
  nullBranchCodeCount: number | null  // kept for backward compat, not used in UI
  branchMatchCount: number | null
  distinctBranchCodeSample: string[]
}

async function getBranchDiagnostics(branch: string): Promise<BranchDiagnostics | null> {
  try {
    const serviceClient = createServiceClient()

    const [
      { count: totalCount },
      { count: matchCount },
      { data: systemIdSample },
    ] = await Promise.all([
      serviceClient.from('app_po_search').select('*', { count: 'exact', head: true }),
      serviceClient.from('app_po_search').select('*', { count: 'exact', head: true }).eq('system_id', branch),
      serviceClient.from('app_po_search').select('system_id').not('system_id', 'is', null).limit(300),
    ])

    const distinctBranchCodes = Array.from(
      new Set((systemIdSample || []).map((r: any) => r.system_id).filter(Boolean))
    ).slice(0, 20) as string[]

    return {
      totalRowsInView: totalCount,
      nullBranchCodeCount: null,
      branchMatchCount: matchCount,
      distinctBranchCodeSample: distinctBranchCodes,
    }
  } catch {
    return null
  }
}

function getDataLoadErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error || '').toLowerCase()

  if (message.includes('missing supabase_service_role_key') || message.includes('missing next_public_supabase_url')) {
    return 'Server Supabase environment variables are missing in this deployment.'
  }

  if (message.includes('does not look like a valid supabase server key') || message.includes('non-service jwt')) {
    return 'The server Supabase key is misconfigured (anon key used where service key is required).'
  }

  if (message.includes('shared po read-model views are not available')) {
    return 'Shared PO read-model views are not available in Supabase yet.'
  }

  return 'Open PO data could not be loaded from Supabase.'
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

  let openPurchaseOrders: OpenPoListRow[] = []
  let submissionSummaries: Awaited<ReturnType<typeof getSubmissionSummariesForPurchaseOrders>> = {}
  let loadErrorMessage: string | null = null
  let branchDiagnostics: BranchDiagnostics | null = null

  if (branch) {
    try {
      openPurchaseOrders = await listOpenPurchaseOrdersForBranch(branch, 150)
      submissionSummaries = await getSubmissionSummariesForPurchaseOrders(
        openPurchaseOrders.map(row => String(row.po_id))
      )
    } catch (error) {
      loadErrorMessage = getDataLoadErrorMessage(error)
    }

    if (!loadErrorMessage && openPurchaseOrders.length === 0) {
      branchDiagnostics = await getBranchDiagnostics(branch)
    }
  }

  const withImagesCount = openPurchaseOrders.filter(
    row => (submissionSummaries[String(row.po_id)]?.count || 0) > 0
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
      ) : loadErrorMessage ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          <p className="font-semibold">Open POs could not be loaded.</p>
          <p className="mt-1">{loadErrorMessage}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-red-800">
            <li>Confirm NEXT_PUBLIC_SUPABASE_URL and public Supabase key are set.</li>
            <li>Confirm SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is set server-side.</li>
            <li>Confirm app_po_* shared read-model views exist in the connected Supabase project.</li>
          </ul>
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
              <div className="px-6 py-10 text-center text-gray-500">
                <div className="mb-3 text-4xl">📭</div>
                <p className="font-medium">No open purchase orders were found for branch {branch}.</p>
                {branchDiagnostics ? (
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-left text-sm text-amber-900">
                    <p className="font-semibold">Branch filter diagnostic</p>
                    <p className="mt-1 text-amber-800">
                      Your profile branch is <strong>{branch}</strong>. Filtering{' '}
                      <code className="rounded bg-amber-100 px-1">app_po_search</code> by{' '}
                      <code className="rounded bg-amber-100 px-1">system_id = &apos;{branch}&apos;</code>.
                    </p>
                    <ul className="mt-3 space-y-1.5 text-amber-800">
                      <li>
                        Total rows in view:{' '}
                        <strong>{branchDiagnostics.totalRowsInView ?? 'unknown'}</strong>
                      </li>
                      <li>
                        Rows matching <strong>{branch}</strong>:{' '}
                        <strong>{branchDiagnostics.branchMatchCount ?? 'unknown'}</strong>
                      </li>
                      {branchDiagnostics.distinctBranchCodeSample.length > 0 ? (
                        <li>
                          Available system_id values in view:{' '}
                          <strong>{branchDiagnostics.distinctBranchCodeSample.join(', ')}</strong>
                        </li>
                      ) : (
                        <li>
                          <strong>No system_id values found in view</strong> — the ERP mirror data may
                          not be synced yet, or the view definition needs to be updated.
                        </li>
                      )}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-gray-400">
                    If you expect results, verify that the ERP mirror data is synced and that{' '}
                    <code className="rounded bg-gray-100 px-1">system_id</code> values in{' '}
                    <code className="rounded bg-gray-100 px-1">app_po_search</code> match your branch code.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-[1fr_0.7fr_0.7fr_0.9fr_56px] gap-4 border-b border-gray-100 bg-gray-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid">
                  <span>PO / Supplier</span>
                  <span>Status</span>
                  <span>Expected</span>
                  <span>Images</span>
                  <span></span>
                </div>
                <div className="divide-y divide-gray-100">
                  {openPurchaseOrders.map(row => {
                    const poNumber = String(row.po_id)
                    const summary = submissionSummaries[poNumber]
                    const hasImages = (summary?.count || 0) > 0

                    return (
                      <Link
                        key={poNumber}
                        href={`/supervisor/open-pos/${encodeURIComponent(poNumber)}`}
                        className="grid gap-3 px-5 py-4 transition-colors hover:bg-gray-50 md:grid-cols-[1fr_0.7fr_0.7fr_0.9fr_56px] md:items-center"
                      >
                        <div>
                          <p className="text-lg font-bold text-gray-900">{poNumber}</p>
                          <p className="text-sm text-gray-500">{row.supplier_key || '—'}</p>
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
