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

export default function ManagerPage() {
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
      .channel('manager-realtime')
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
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Manager Dashboard</h1>
        <p className="text-gray-500">Overview of all PO submissions across branches</p>
      </header>

      {/* Stats bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <p className="text-3xl font-bold text-gray-900">{todayCount}</p>
          <p className="text-sm text-gray-500">Submissions Today</p>
        </div>
        <div className={`rounded-2xl p-6 shadow-sm border ${pendingCount > 0 ? 'bg-yellow-50 border-yellow-100' : 'bg-white border-gray-100'}`}>
          <p className={`text-3xl font-bold ${pendingCount > 0 ? 'text-yellow-700' : 'text-gray-900'}`}>{pendingCount}</p>
          <p className="text-sm text-gray-500">Pending Review</p>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <p className="text-3xl font-bold text-gray-900">{weekCount}</p>
          <p className="text-sm text-gray-500">Recent Activity ({days}d)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              type="text"
              placeholder="Search by PO number…"
              value={search}
              onChange={e => setSearch(e.target.value.toUpperCase())}
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-600 transition-colors"
            />
          </div>
          <div className="flex gap-3">
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-600 bg-white"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="reviewed">Reviewed</option>
              <option value="flagged">Flagged</option>
            </select>
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-600 bg-white"
            >
              <option value={1}>Today</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
            <button
              onClick={fetchSubmissions}
              className="px-6 py-3 bg-green-700 hover:bg-green-800 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-20 bg-gray-50/50 animate-pulse" />
            ))}
          </div>
        ) : submissions.length === 0 ? (
          <div className="py-24 text-center">
            <div className="text-5xl mb-4">📋</div>
            <p className="text-gray-500 font-medium">No submissions found</p>
            <p className="text-sm text-gray-400 mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-20">Photo</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">PO Number</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Submitted By</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Branch</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Date / Time</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {submissions.map(sub => (
                  <tr key={sub.id} className="hover:bg-gray-50/80 transition-colors group cursor-pointer" onClick={() => window.location.href = `/manager/${sub.id}`}>
                    <td className="px-6 py-4">
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                        <img src={sub.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-bold text-gray-900">{sub.po_number}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-600 font-medium">{sub.submitted_username}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-500">{sub.branch || '—'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-500">{formatDateTime(sub.created_at)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={sub.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-gray-300 group-hover:text-gray-400 transition-colors opacity-0 group-hover:opacity-100">→</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
