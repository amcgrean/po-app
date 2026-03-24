import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPurchaseOrder, getPurchaseOrderSubmissions } from '@/lib/po/server'
import { formatDate, formatDateTime } from '@/lib/utils'

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

  return 'PO detail data could not be loaded from Supabase.'
}

function formatCurrency(value: number | null) {
  if (value == null) return '—'
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

export const dynamic = 'force-dynamic'

export default async function SupervisorOpenPoDetailPage({
  params,
}: {
  params: { poNumber: string }
}) {
  const poNumber = decodeURIComponent(params.poNumber)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = user
    ? await supabase.from('profiles').select('branch').eq('id', user.id).maybeSingle()
    : { data: null }

  const branch = profile?.branch?.trim().toUpperCase() || null
  let poResult: Awaited<ReturnType<typeof getPurchaseOrder>> | null = null
  let submissions: Awaited<ReturnType<typeof getPurchaseOrderSubmissions>> = []
  let loadErrorMessage: string | null = null

  try {
    poResult = await getPurchaseOrder(poNumber)
    if (poResult?.header) {
      submissions = await getPurchaseOrderSubmissions(poNumber, branch)
    }
  } catch (error) {
    loadErrorMessage = getDataLoadErrorMessage(error)
  }

  if (loadErrorMessage) {
    return (
      <div className="space-y-4">
        <Link
          href="/supervisor/open-pos"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <span>←</span>
          Back to open POs
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          <p className="font-semibold">PO details could not be loaded.</p>
          <p className="mt-1">{loadErrorMessage}</p>
        </div>
      </div>
    )
  }

  if (!poResult?.header) {
    notFound()
  }

  const header = poResult.header

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Link
            href="/supervisor/open-pos"
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <span>←</span>
            Back to open POs
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">PO {header.po_number}</h1>
          <p className="mt-1 text-sm text-gray-500">
            ERP mirror details{branch ? ` for branch ${branch}` : ''}, plus any branch submission images tied to this PO.
          </p>
        </div>
        <Link
          href="/supervisor"
          className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Supervisor dashboard
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:col-span-2">
          <p className="text-sm text-gray-500">Supplier</p>
          <p className="mt-2 text-xl font-bold text-gray-900">
            {header.supplier_name || 'Supplier unavailable'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {header.supplier_city || '—'}
            {header.supplier_state ? `, ${header.supplier_state}` : ''}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">ERP status</p>
          <p className="mt-2 text-xl font-bold text-gray-900">{header.po_status || 'Open'}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">PO total</p>
          <p className="mt-2 text-xl font-bold text-gray-900">{formatCurrency(header.po_total)}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Header summary</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Order date</p>
                <p className="mt-1 text-sm font-medium text-gray-800">
                  {header.order_date ? formatDate(header.order_date) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Expected date</p>
                <p className="mt-1 text-sm font-medium text-gray-800">
                  {header.expect_date ? formatDate(header.expect_date) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Buyer</p>
                <p className="mt-1 text-sm font-medium text-gray-800">{header.buyer || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Reference</p>
                <p className="mt-1 text-sm font-medium text-gray-800">{header.reference || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Ship via</p>
                <p className="mt-1 text-sm font-medium text-gray-800">{header.ship_via || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Line count</p>
                <p className="mt-1 text-sm font-medium text-gray-800">{header.line_count ?? 0}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-gray-900">Line items</h2>
              <p className="text-sm text-gray-500">{poResult.detail.length} lines</p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {poResult.detail.map(line => (
                    <tr key={`${line.po_number}-${line.line_number}`}>
                      <td className="px-3 py-3 font-medium text-gray-900">{line.line_number}</td>
                      <td className="px-3 py-3 text-gray-700">{line.item_code || '—'}</td>
                      <td className="px-3 py-3 text-gray-700">{line.description || '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{line.qty_ordered ?? '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{formatCurrency(line.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Receiving summary</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Receipt count</span>
                <span className="font-medium text-gray-900">{poResult.receiving?.receipt_count ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Qty received</span>
                <span className="font-medium text-gray-900">{poResult.receiving?.qty_received_total ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">First receipt</span>
                <span className="font-medium text-gray-900">
                  {poResult.receiving?.first_receive_date
                    ? formatDate(poResult.receiving.first_receive_date)
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Last receipt</span>
                <span className="font-medium text-gray-900">
                  {poResult.receiving?.last_receive_date
                    ? formatDate(poResult.receiving.last_receive_date)
                    : '—'}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-gray-900">Submission images</h2>
              <p className="text-sm text-gray-500">{submissions.length} records</p>
            </div>

            {submissions.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                No submission photos have been recorded for this PO yet.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {submissions.map(submission => {
                  const images = submission.image_urls?.length
                    ? submission.image_urls
                    : submission.image_url
                      ? [submission.image_url]
                      : []

                  return (
                    <div key={submission.id} className="rounded-2xl border border-gray-100 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-gray-900">{submission.submitted_username}</p>
                          <p className="text-sm text-gray-500">{formatDateTime(submission.created_at)}</p>
                          <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">
                            Status: {submission.status}
                          </p>
                        </div>
                        <Link
                          href={`/supervisor/${submission.id}`}
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Review submission
                        </Link>
                      </div>

                      {submission.notes ? (
                        <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
                          Worker note: {submission.notes}
                        </p>
                      ) : null}

                      {submission.reviewer_notes ? (
                        <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800">
                          Reviewer note: {submission.reviewer_notes}
                        </p>
                      ) : null}

                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {images.map((imageUrl, index) => (
                          <a
                            key={`${submission.id}-${index}`}
                            href={imageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50"
                          >
                            <img
                              src={imageUrl}
                              alt={`Submission ${submission.id} image ${index + 1}`}
                              className="h-36 w-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
