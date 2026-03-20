'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { formatDateTime, formatDate } from '@/lib/utils'
import StatusBadge from '@/components/StatusBadge'
import type { PoLookupResult } from '@/lib/po/types'

interface Submission {
  id: string
  po_number: string
  image_url: string
  image_urls?: string[]
  submitted_username: string
  branch: string | null
  notes: string | null
  status: string
  reviewer_notes: string | null
  reviewed_at: string | null
  created_at: string
}

export default function SubmissionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [submission, setSubmission] = useState<Submission | null>(null)
  const [poResult, setPoResult] = useState<PoLookupResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingPo, setLoadingPo] = useState(false)
  const [poError, setPoError] = useState<string | null>(null)
  const [reviewerNotes, setReviewerNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const res = await fetch(`/api/submissions/${id}`)
        if (!res.ok) throw new Error('Not found')
        const data = await res.json()
        setSubmission(data)
        setReviewerNotes(data.reviewer_notes || '')

        // Fetch ERP mirror data
        if (data.po_number) {
          loadPoDetails(data.po_number)
        }
      } catch (err) {
        console.error('Load error', err)
        router.push('/supervisor')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, router])

  async function loadPoDetails(poNumber: string) {
    setLoadingPo(true)
    setPoError(null)
    try {
      const res = await fetch(`/api/po/${poNumber}`)
      if (res.status === 404) {
        setPoError('PO not found in ERP mirror.')
        return
      }
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to load ERP details')
      }
      const data = await res.json()
      setPoResult(data)
    } catch (err: any) {
      setPoError(err.message || 'Could not load ERP data. Mirror views may not be applied.')
    } finally {
      setLoadingPo(false)
    }
  }

  async function updateStatus(newStatus: string) {
    if (!submission) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reviewer_notes: reviewerNotes }),
      })
      if (!res.ok) throw new Error('Failed to save')
      const updated = await res.json()
      setSubmission(updated)
      setReviewerNotes(updated.reviewer_notes || '')
    } catch (err: any) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <svg className="animate-spin w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  if (!submission) return null

  const photos = submission.image_urls && submission.image_urls.length > 0 
    ? submission.image_urls 
    : [submission.image_url]

  return (
    <>
      {/* Lightbox */}
      {activeImageIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setActiveImageIndex(null)}
        >
          <img 
            src={photos[activeImageIndex]} 
            alt="Full size" 
            className="max-w-[95%] max-h-[95%] object-contain" 
          />
          <button
            className="absolute top-4 right-4 text-white text-4xl w-12 h-12 flex items-center justify-center rounded-full bg-black/50"
            onClick={(e) => { e.stopPropagation(); setActiveImageIndex(null); }}
          >
            ×
          </button>
          
          {photos.length > 1 && (
            <div className="absolute bottom-10 left-0 right-0 flex justify-center gap-4 px-4" onClick={e => e.stopPropagation()}>
              <button 
                disabled={activeImageIndex === 0}
                onClick={() => setActiveImageIndex(activeImageIndex - 1)}
                className="bg-white/10 text-white px-4 py-2 rounded-full disabled:opacity-20"
              >
                ← Prev
              </button>
              <span className="text-white/60 self-center text-sm">
                {activeImageIndex + 1} / {photos.length}
              </span>
              <button 
                disabled={activeImageIndex === photos.length - 1}
                onClick={() => setActiveImageIndex(activeImageIndex + 1)}
                className="bg-white/10 text-white px-4 py-2 rounded-full disabled:opacity-20"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Back nav */}
      <div className="mb-6">
        <Link href="/supervisor" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Gallery */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span>🖼️</span> Photos ({photos.length})
            </h3>
            
            <div className="space-y-4">
              {photos.map((url, i) => (
                <div
                  key={i}
                  className="bg-gray-50 rounded-xl overflow-hidden cursor-zoom-in border border-gray-100 hover:border-green-300 transition-colors"
                  onClick={() => setActiveImageIndex(i)}
                >
                  <img
                    src={url}
                    alt={`Submission photo ${i + 1}`}
                    className="w-full object-cover"
                    style={{ maxHeight: '500px' }}
                  />
                  <p className="text-[10px] text-gray-400 text-center py-1.5 uppercase tracking-wider">
                    Photo {i + 1} • Click to enlarge
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-4">
          {/* PO Info */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">PO Number</p>
                <p className="text-3xl font-bold text-gray-900">{submission.po_number}</p>
              </div>
              <StatusBadge status={submission.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Submitted by</p>
                <p className="font-medium text-gray-900">{submission.submitted_username}</p>
              </div>
              {submission.branch && (
                <div>
                  <p className="text-gray-500">Branch</p>
                  <p className="font-medium text-gray-900">{submission.branch}</p>
                </div>
              )}
              <div>
                <p className="text-gray-500">Date / Time</p>
                <p className="font-medium text-gray-900">{formatDateTime(submission.created_at)}</p>
              </div>
            </div>

            {submission.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-sm text-gray-500 mb-1">Worker Notes</p>
                <p className="text-sm text-gray-800 italic">"{submission.notes}"</p>
              </div>
            )}
          </div>

          {/* ERP Mirror Details */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center justify-between">
              <span>📋 ERP Mirror Details</span>
              {loadingPo && (
                <span className="text-[10px] font-normal text-gray-400 animate-pulse">Refreshing…</span>
              )}
            </h3>

            {poError ? (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
                <p className="font-semibold mb-1">Mirror not ready</p>
                <p className="opacity-80">{poError}</p>
              </div>
            ) : !poResult ? (
              <div className="py-8 text-center text-gray-400">
                <p className="text-sm italic">Loading ERP data...</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header Summary */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs border-b border-gray-50 pb-4">
                  <div>
                    <p className="text-gray-400 mb-0.5">Supplier</p>
                    <p className="font-bold text-gray-900 truncate">
                      {poResult.header?.supplier_name || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 mb-0.5">Status</p>
                    <p className="font-bold text-gray-900">
                      {poResult.header?.po_status || 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 mb-0.5">Expected Date</p>
                    <p className="font-bold text-gray-900">
                      {poResult.header?.expect_date ? formatDate(poResult.header.expect_date) : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 mb-0.5">Total (ERP)</p>
                    <p className="font-bold text-gray-900">
                      ${poResult.header?.po_total?.toLocaleString() ?? '—'}
                    </p>
                  </div>
                </div>

                {/* Receiving Summary */}
                <div className="bg-green-50/50 rounded-xl p-3 border border-green-100 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-green-700 font-bold mb-0.5">Receiving Summary</p>
                    <p className="text-xs text-green-900 font-medium">
                      {poResult.receiving?.qty_received_total ?? 0} items across {poResult.receiving?.receipt_count ?? 0} receipts
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-green-700 font-bold mb-0.5">Last Rcvd</p>
                    <p className="text-xs text-green-900 font-medium">
                      {poResult.receiving?.last_receive_date ? formatDate(poResult.receiving.last_receive_date) : 'None'}
                    </p>
                  </div>
                </div>

                {/* Line Items */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Line Items ({poResult.detail?.length ?? 0})</p>
                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-gray-50 text-gray-500 font-medium">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2 text-right">Ordered</th>
                          <th className="px-3 py-2 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {poResult.detail?.slice(0, 10).map((line, i) => (
                          <tr key={i} className="hover:bg-gray-50/50">
                            <td className="px-3 py-2">
                              <p className="font-bold text-gray-900 truncate max-w-[120px]">{line.item_code}</p>
                              <p className="text-gray-400 truncate max-w-[120px]">{line.description}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-gray-700">
                              {line.qty_ordered} <span className="text-[9px] uppercase">{line.uom}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-gray-400">
                              ${line.cost?.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                        {(poResult.detail?.length ?? 0) > 10 && (
                          <tr>
                            <td colSpan={3} className="px-3 py-1.5 text-center text-[10px] text-gray-400 bg-gray-50/30">
                              + {poResult.detail.length - 10} more lines
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Review Actions */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-3">Review</h3>

            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">Reviewer Notes</label>
              <textarea
                value={reviewerNotes}
                onChange={e => setReviewerNotes(e.target.value)}
                placeholder="Add notes for your records…"
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600 resize-none"
              />
            </div>

            {saveError && (
              <p className="text-red-600 text-sm mb-3">{saveError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => updateStatus('reviewed')}
                disabled={saving}
                className="flex-1 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ backgroundColor: '#006834' }}
              >
                {saving ? 'Saving…' : '✓ Mark Reviewed'}
              </button>
              <button
                onClick={() => updateStatus('flagged')}
                disabled={saving}
                className="flex-1 py-3 rounded-xl text-white font-semibold text-sm bg-red-600 disabled:opacity-50"
              >
                ⚑ Flag
              </button>
            </div>

            {submission.status !== 'pending' && (
              <button
                onClick={() => updateStatus('pending')}
                disabled={saving}
                className="w-full mt-2 py-2 rounded-xl text-gray-600 text-sm border border-gray-300 disabled:opacity-50"
              >
                Reset to Pending
              </button>
            )}

            {submission.reviewed_at && (
              <p className="text-xs text-gray-400 mt-3 text-center">
                Last reviewed: {formatDateTime(submission.reviewed_at)}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
