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

export default function ManagerSubmissionDetailPage() {
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
        router.push('/manager')
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
    <div className="max-w-6xl mx-auto px-4 py-8">
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
        <Link href="/manager" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Gallery */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-900 mb-6 flex items-center gap-2 text-lg">
              <span>🖼️</span> Submissions Photos ({photos.length})
            </h3>
            
            <div className="space-y-6">
              {photos.map((url, i) => (
                <div
                  key={i}
                  className="bg-gray-50 rounded-2xl overflow-hidden cursor-zoom-in border border-gray-100 hover:border-green-300 transition-all hover:shadow-md"
                  onClick={() => setActiveImageIndex(i)}
                >
                  <img
                    src={url}
                    alt={`Submission photo ${i + 1}`}
                    className="w-full object-cover"
                    style={{ maxHeight: '600px' }}
                  />
                  <div className="bg-white/80 backdrop-blur-sm py-2 text-center border-t border-gray-100">
                     <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                        Photo {i + 1} • Click to enlarge
                      </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-6">
          {/* PO Info */}
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-green-50 rounded-full -mr-16 -mt-16 opacity-50" />
             
            <div className="flex items-start justify-between mb-8 relative z-10">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">PO Number</p>
                <p className="text-5xl font-black text-gray-900 tracking-tight">{submission.po_number}</p>
              </div>
              <StatusBadge status={submission.status} />
            </div>

            <div className="grid grid-cols-2 gap-8 text-sm relative z-10">
              <div>
                <p className="text-gray-400 font-medium mb-1">Submitted by</p>
                <p className="font-bold text-gray-900 text-base">{submission.submitted_username}</p>
              </div>
              {submission.branch && (
                <div>
                  <p className="text-gray-400 font-medium mb-1">Branch</p>
                  <p className="font-bold text-gray-900 text-base">{submission.branch}</p>
                </div>
              )}
              <div className="col-span-2">
                <p className="text-gray-400 font-medium mb-1">Date / Time</p>
                <p className="font-bold text-gray-900 text-base">{formatDateTime(submission.created_at)}</p>
              </div>
            </div>

            {submission.notes && (
              <div className="mt-8 pt-8 border-t border-gray-100 relative z-10">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Worker Notes</p>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                   <p className="text-gray-700 italic text-base">"{submission.notes}"</p>
                </div>
              </div>
            )}
          </div>

          {/* ERP Mirror Details */}
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center justify-between">
              <span>📋 ERP Mirror</span>
              {loadingPo && (
                <span className="text-xs font-normal text-gray-400 animate-pulse">Fetching latest…</span>
              )}
            </h3>

            {poError ? (
              <div className="bg-amber-50 border border-amber-100 text-amber-900 rounded-2xl p-6">
                <p className="font-bold mb-1 flex items-center gap-2">
                  <span className="text-lg">⚠️</span> Mirror logic not applied
                </p>
                <p className="text-sm opacity-80 leading-relaxed">{poError}</p>
              </div>
            ) : !poResult ? (
              <div className="py-12 text-center text-gray-400 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                <p className="text-sm italic">Synchronizing with ERP mirror...</p>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Header Summary Cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Supplier</p>
                    <p className="font-bold text-gray-900 truncate">{poResult.header?.supplier_name || 'N/A'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">ERP Status</p>
                    <p className="font-bold text-gray-900">{poResult.header?.po_status || 'Unknown'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Expected</p>
                    <p className="font-bold text-gray-900">{poResult.header?.expect_date ? formatDate(poResult.header.expect_date) : 'N/A'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">PO Total</p>
                    <p className="font-bold text-gray-900">${poResult.header?.po_total?.toLocaleString() ?? '—'}</p>
                  </div>
                </div>

                {/* Receiving Insight */}
                <div className="bg-green-700 rounded-2xl p-6 text-white shadow-lg shadow-green-900/10">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60 mb-3">Receiving Insight</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-3xl font-black mb-1">{poResult.receiving?.qty_received_total ?? 0}</p>
                      <p className="text-xs font-medium opacity-80 underline underline-offset-4 decoration-white/20">
                        Items received across {poResult.receiving?.receipt_count ?? 0} tickets
                      </p>
                    </div>
                    <div className="text-right">
                       <p className="text-[10px] font-bold opacity-60 uppercase mb-1">Last activity</p>
                       <p className="text-sm font-bold">
                         {poResult.receiving?.last_receive_date ? formatDate(poResult.receiving.last_receive_date) : 'No receipts'}
                       </p>
                    </div>
                  </div>
                </div>

                {/* ERP Line Items Table */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">ERP Line Details ({poResult.detail?.length ?? 0})</p>
                  </div>
                  <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 font-bold">
                        <tr>
                          <th className="px-5 py-4">Item & Description</th>
                          <th className="px-5 py-4 text-right">Qty</th>
                          <th className="px-5 py-4 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {poResult.detail?.slice(0, 5).map((line, i) => (
                          <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-5 py-4">
                              <p className="font-bold text-gray-900 mb-0.5">{line.item_code}</p>
                              <p className="text-[10px] text-gray-400 truncate max-w-[200px]">{line.description}</p>
                            </td>
                            <td className="px-5 py-4 text-right font-bold text-gray-700">
                              {line.qty_ordered} <span className="text-[10px] text-gray-400 font-normal ml-0.5">{line.uom}</span>
                            </td>
                            <td className="px-5 py-4 text-right text-gray-500 font-medium">
                              ${line.cost?.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                        {(poResult.detail?.length ?? 0) > 5 && (
                          <tr>
                            <td colSpan={3} className="px-5 py-3 text-center text-[10px] text-gray-400 font-bold bg-gray-50/50 uppercase tracking-widest">
                              + {poResult.detail.length - 5} additional line items in ERP
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
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-6">Review & Audit</h3>

            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Reviewer Notes</label>
              <textarea
                value={reviewerNotes}
                onChange={e => setReviewerNotes(e.target.value)}
                placeholder="Add audit notes or instructions…"
                rows={4}
                className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-2xl text-base focus:outline-none focus:border-green-600 focus:bg-white transition-all resize-none"
              />
            </div>

            {saveError && (
              <p className="text-red-600 font-bold text-sm mb-4">⚠️ {saveError}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={() => updateStatus('reviewed')}
                disabled={saving}
                className="flex-1 py-4 bg-green-700 hover:bg-green-800 text-white font-black rounded-2xl text-lg transition-all shadow-lg shadow-green-900/10 disabled:opacity-50"
              >
                {saving ? 'Saving…' : '✓ Mark Reviewed'}
              </button>
              <button
                onClick={() => updateStatus('flagged')}
                disabled={saving}
                className="flex-1 py-4 bg-red-600 hover:bg-red-700 text-white font-black rounded-2xl text-lg transition-all shadow-lg shadow-red-900/10 disabled:opacity-50"
              >
                ⚑ Flag Issue
              </button>
            </div>

            {submission.status !== 'pending' && (
              <button
                onClick={() => updateStatus('pending')}
                disabled={saving}
                className="w-full mt-4 py-3 bg-white hover:bg-gray-50 text-gray-500 font-bold rounded-2xl text-sm border border-gray-200 transition-all disabled:opacity-50"
              >
                Reset Status
              </button>
            )}

            {submission.reviewed_at && (
              <p className="text-xs text-gray-400 mt-6 text-center font-medium">
                Last modified: {formatDateTime(submission.reviewed_at)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
