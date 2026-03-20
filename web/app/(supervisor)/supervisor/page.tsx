'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatDateTime, isToday } from '@/lib/utils'
import StatusBadge from '@/components/StatusBadge'
import { createClient } from '@/lib/supabase/client'

interface Submission {
  id: string
  po_number: string
  image_url: string
  submitted_username: string
  branch: string | null
  notes: string | null
  status: string
  created_at: string
}

export default function SupervisorPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [days, setDays] = useState(7)

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status,
        days: String(days),
        limit: '100',
      })
      if (search.trim()) params.set('po_number', search.trim())

      const res = await fetch(`/api/submissions?${params}`)
      if (!res.ok) throw new Error('Failed to load')
      setSubmissions(await res.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search, status, days])

  useEffect(() => {
    fetchSubmissions()
  }, [fetchSubmissions])

  // Realtime updates
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('submissions-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => {
        fetchSubmissions()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchSubmissions])

  const todayCount = submissions.filter(s => isToday(s.created_at)).length
  const pendingCount = submissions.filter(s => s.status === 'pending').length
  const weekCount = submissions.length

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
          <p className="text-3xl font-bold text-gray-900">{todayCount}</p>
          <p className="text-xs text-gray-500 mt-1">Today</p>
        </div>
        <div className={`rounded-xl p-4 shadow-sm border text-center ${pendingCount > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-100'}`}>
          <p className={`text-3xl font-bold ${pendingCount > 0 ? 'text-yellow-700' : 'text-gray-900'}`}>{pendingCount}</p>
          <p className="text-xs text-gray-500 mt-1">Pending Review</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
          <p className="text-3xl font-bold text-gray-900">{weekCount}</p>
          <p className="text-xs text-gray-500 mt-1">Last {days}d Total</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by PO number…"
              value={search}
              onChange={e => setSearch(e.target.value.toUpperCase())}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-green-600"
            />
          </div>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-green-600 bg-white"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="flagged">Flagged</option>
          </select>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-green-600 bg-white"
          >
            <option value={1}>Today</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchSubmissions}
            className="px-4 py-2.5 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#006834' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Table / List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 bg-gray-50 animate-pulse" />
            ))}
          </div>
        ) : submissions.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <p>No submissions found</p>
          </div>
        ) : (
          <>
            {/* Table header — desktop */}
            <div className="hidden sm:grid grid-cols-[80px_1fr_1fr_1fr_1fr_120px_60px] gap-4 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <span>Photo</span>
              <span>PO Number</span>
              <span>Submitted By</span>
              <span>Date / Time</span>
              <span>Branch</span>
              <span>Status</span>
              <span></span>
            </div>

            <div className="divide-y divide-gray-100">
              {submissions.map(sub => (
                <Link
                  key={sub.id}
                  href={`/supervisor/${sub.id}`}
                  className="flex sm:grid sm:grid-cols-[80px_1fr_1fr_1fr_1fr_120px_60px] items-center gap-3 sm:gap-4 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  {/* Thumbnail */}
                  <div className="w-14 h-14 sm:w-14 sm:h-14 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    <img src={sub.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </div>

                  {/* Mobile: stacked info */}
                  <div className="flex-1 min-w-0 sm:contents">
                    <span className="font-bold text-gray-900 sm:self-center truncate block sm:inline">
                      {sub.po_number}
                    </span>
                    <span className="text-sm text-gray-600 sm:self-center truncate block sm:inline">
                      {sub.submitted_username}
                    </span>
                    <span className="text-xs text-gray-400 sm:self-center sm:text-sm sm:text-gray-600 block sm:inline">
                      {formatDateTime(sub.created_at)}
                    </span>
                    <span className="text-xs text-gray-400 sm:self-center hidden sm:block">
                      {sub.branch || '—'}
                    </span>
                    <span className="sm:self-center mt-1 sm:mt-0 block sm:inline">
                      <StatusBadge status={sub.status} />
                    </span>
                  </div>

                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
