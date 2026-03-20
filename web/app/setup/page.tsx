'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

interface User {
  id: string
  username: string
  display_name: string | null
  role: string
  branch: string | null
  created_at: string
}

function SetupContent() {
  const searchParams = useSearchParams()
  const secret = searchParams.get('secret') || ''

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    password: '',
    role: 'worker',
    branch: '',
  })
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({})

  const authorized = !!secret

  async function loadUsers() {
    if (!authorized) return
    setLoading(true)
    try {
      const res = await fetch(`/api/setup?secret=${encodeURIComponent(secret)}`)
      if (!res.ok) throw new Error('Unauthorized')
      setUsers(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [secret])

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/setup?secret=${encodeURIComponent(secret)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(`User "${form.username}" created!`)
      setForm({ username: '', display_name: '', password: '', role: 'worker', branch: '' })
      await loadUsers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function resetPassword(userId: string, username: string) {
    const newPassword = resetPasswords[userId]?.trim()
    if (!newPassword) return
    setResetting(userId)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/setup?secret=${encodeURIComponent(secret)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password: newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(`Password for "${username}" reset successfully.`)
      setResetPasswords(p => { const n = { ...p }; delete n[userId]; return n })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setResetting(null)
    }
  }

  async function deleteUser(userId: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    setDeleting(userId)
    try {
      const res = await fetch(`/api/setup?secret=${encodeURIComponent(secret)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) throw new Error('Failed to delete')
      await loadUsers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setDeleting(null)
    }
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-sm border">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Setup Required</h1>
          <p className="text-sm text-gray-500">
            Access this page with <code className="bg-gray-100 px-1 rounded">?secret=YOUR_SETUP_SECRET</code>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: '#006834' }}
            >
              PO
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Setup & User Management</h1>
          </div>
          <p className="text-sm text-gray-500 ml-13">PO Check-In Admin</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-4">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline">Dismiss</button>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm mb-4">
            {success}
          </div>
        )}

        {/* Create user form */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">Create New User</h2>
          <form onSubmit={createUser} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
                <input
                  type="text"
                  required
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase() }))}
                  placeholder="e.g. jeffw"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600"
                />
                <p className="text-xs text-gray-400 mt-1">Login: {form.username || 'username'}@checkin.internal</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="e.g. Jeff W."
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                <input
                  type="text"
                  required
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Choose a password"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600 bg-white"
                >
                  <option value="worker">Worker</option>
                  <option value="supervisor">Supervisor</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
              <input
                type="text"
                value={form.branch}
                onChange={e => setForm(f => ({ ...f, branch: e.target.value.toUpperCase() }))}
                placeholder="e.g. 10FD (optional)"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600"
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
              style={{ backgroundColor: '#006834' }}
            >
              {creating ? 'Creating…' : 'Create User'}
            </button>
          </form>
        </div>

        {/* User list */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">
              Users ({users.length})
            </h2>
            <button onClick={loadUsers} className="text-sm text-gray-500 hover:text-gray-700">
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="space-y-px">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 bg-gray-50 animate-pulse" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No users yet</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {users.map(user => (
                <div key={user.id} className="px-6 py-3">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{user.username}</span>
                        {user.display_name && (
                          <span className="text-sm text-gray-500">({user.display_name})</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          user.role === 'supervisor'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {user.role}
                        </span>
                        {user.branch && (
                          <span className="text-xs text-gray-400">{user.branch}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{user.username}@checkin.internal</p>
                    </div>
                    <button
                      onClick={() => setResetPasswords(p =>
                        p[user.id] !== undefined
                          ? (() => { const n = { ...p }; delete n[user.id]; return n })()
                          : { ...p, [user.id]: '' }
                      )}
                      className="text-gray-400 hover:text-gray-600 text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50"
                    >
                      Reset pw
                    </button>
                    <button
                      onClick={() => deleteUser(user.id, user.username)}
                      disabled={deleting === user.id}
                      className="text-red-500 hover:text-red-700 text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      {deleting === user.id ? '…' : 'Delete'}
                    </button>
                  </div>
                  {resetPasswords[user.id] !== undefined && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={resetPasswords[user.id]}
                        onChange={e => setResetPasswords(p => ({ ...p, [user.id]: e.target.value }))}
                        placeholder="New password"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600"
                      />
                      <button
                        onClick={() => resetPassword(user.id, user.username)}
                        disabled={resetting === user.id || !resetPasswords[user.id]?.trim()}
                        className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50"
                        style={{ backgroundColor: '#006834' }}
                      >
                        {resetting === user.id ? '…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Initial users note */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl px-4 py-4 text-sm text-blue-700">
          <p className="font-medium mb-2">Initial users to create:</p>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">
            {['jeffw', 'andrewc', 'nigelc', 'bradf', 'mariol'].map(u => (
              <span key={u}>• {u}</span>
            ))}
          </div>
          <p className="mt-2 text-xs text-blue-600">
            All workers by default. Promote one to supervisor as needed.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupContent />
    </Suspense>
  )
}
