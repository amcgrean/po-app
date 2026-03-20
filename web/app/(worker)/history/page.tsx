'use client'

import { useState, useEffect } from 'react'
import SubmissionCard from '@/components/SubmissionCard'

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

export default function HistoryPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/submissions?limit=20')
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        setSubmissions(data)
      } catch {
        setError('Could not load history')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-4 py-4 safe-top" style={{ backgroundColor: '#006834' }}>
        <h1 className="text-xl font-bold">My Submissions</h1>
        <p className="text-sm text-white/70">Last 20 check-ins</p>
      </div>

      <div className="px-4 py-4 max-w-lg mx-auto">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl h-20 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-4 text-sm text-center">
            {error}
          </div>
        )}

        {!loading && !error && submissions.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <p>No submissions yet</p>
          </div>
        )}

        {!loading && submissions.length > 0 && (
          <div className="space-y-3">
            {submissions.map(sub => (
              <SubmissionCard key={sub.id} submission={sub} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
