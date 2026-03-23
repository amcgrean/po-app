'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

interface User {
  id: string
  username: string
  display_name: string | null
  role: string
  branch: string | null
  created_at: string
}

interface UserManagementClientProps {
  mode: 'setup' | 'admin'
}

function normalizeBranch(branch: string) {
  return branch.trim().toUpperCase()
}

function roleRequiresBranch(role: string) {
  return role !== 'admin'
}

export default function UserManagementClient({ mode }: UserManagementClientProps) {
  const searchParams = useSearchParams()
  const secret = mode === 'setup' ? searchParams.get('secret') || '' : ''

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [authorized, setAuthorized] = useState(mode === 'admin')
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    password: '',
    role: 'worker',
    branch: '',
  })
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [editForms, setEditForms] = useState<
    Record<
      string,
      {
        username: string
        display_name: string
        role: string
        branch: string
        password: string
      }
    >
  >({})

  const endpoint = useMemo(
    () => `/api/setup${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`,
    [secret]
  )

  function syncEditForms(nextUsers: User[]) {
    setEditForms(current => {
      const next = { ...current }
      for (const user of nextUsers) {
        next[user.id] = next[user.id] || {
          username: user.username || '',
          display_name: user.display_name || '',
          role: user.role,
          branch: user.branch || '',
          password: '',
        }
      }
      return next
    })
  }

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load users')
      setUsers(data)
      syncEditForms(data)
      setAuthorized(true)
    } catch (err: any) {
      setUsers([])
      setAuthorized(false)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [endpoint])

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    const branch = normalizeBranch(form.branch)

    if (roleRequiresBranch(form.role) && !branch) {
      setError('A home branch is required for every non-admin user.')
      return
    }

    setCreating(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          branch: branch || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(`User "${form.username}" created.`)
      setForm({ username: '', display_name: '', password: '', role: 'worker', branch: '' })
      await loadUsers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function saveUser(userId: string) {
    const edit = editForms[userId]
    if (!edit) return

    const branch = normalizeBranch(edit.branch)
    if (roleRequiresBranch(edit.role) && !branch) {
      setError('A home branch is required for every non-admin user.')
      return
    }

    setSavingUserId(userId)
    setError('')
    setSuccess('')

    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          username: edit.username.trim().toLowerCase(),
          display_name: edit.display_name.trim() || null,
          role: edit.role,
          branch: branch || null,
          password: edit.password.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(`Updated "${edit.username}".`)
      setEditForms(current => ({
        ...current,
        [userId]: {
          ...current[userId],
          password: '',
        },
      }))
      await loadUsers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSavingUserId(null)
    }
  }

  async function deleteUser(userId: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    setDeleting(userId)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete user')
      setSuccess(`Deleted "${username}".`)
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
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {mode === 'setup' ? 'Setup Secret Required' : 'Admin Access Required'}
          </h1>
          <p className="text-sm text-gray-500">
            {mode === 'setup'
              ? <>Open this page with <code className="bg-gray-100 px-1 rounded">?secret=YOUR_SETUP_SECRET</code> or sign in as an admin.</>
              : 'Sign in with an admin account to manage users.'}
          </p>
          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: '#006834' }}
            >
              PO
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              {mode === 'setup' ? 'Setup & User Management' : 'Admin User Management'}
            </h1>
          </div>
          <p className="text-sm text-gray-500">
            Every non-admin user must have a home branch. Admin accounts can manage users without a setup secret.
          </p>
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-4">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        ) : null}

        {success ? (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm mb-4">
            {success}
          </div>
        ) : null}

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">Create New User</h2>
          <form onSubmit={createUser} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
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
                <p className="text-xs text-gray-400 mt-1">
                  Login: {form.username || 'username'}@checkin.internal
                </p>
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

            <div className="grid gap-4 md:grid-cols-3">
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
                  onChange={e => {
                    const role = e.target.value
                    setForm(f => ({
                      ...f,
                      role,
                      branch: role === 'admin' ? '' : f.branch,
                    }))
                  }}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600 bg-white"
                >
                  <option value="worker">Worker</option>
                  <option value="manager">Manager</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Home Branch {roleRequiresBranch(form.role) ? '*' : ''}
                </label>
                <input
                  type="text"
                  required={roleRequiresBranch(form.role)}
                  value={form.branch}
                  onChange={e => setForm(f => ({ ...f, branch: e.target.value.toUpperCase() }))}
                  placeholder={form.role === 'admin' ? 'Not required for admins' : 'e.g. 10FD'}
                  disabled={!roleRequiresBranch(form.role)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
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

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Users ({users.length})</h2>
            <button onClick={() => void loadUsers()} className="text-sm text-gray-500 hover:text-gray-700">
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="space-y-px">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-gray-50 animate-pulse" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No users yet</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {users.map(user => {
                const edit = editForms[user.id]
                if (!edit) return null

                return (
                  <div key={user.id} className="p-5 space-y-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{user.display_name || user.username}</p>
                        <p className="text-sm text-gray-500">
                          {user.username}@checkin.internal
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                          {user.role}
                        </span>
                        {user.branch ? (
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700">
                            {user.branch}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-4">
                      <input
                        type="text"
                        value={edit.username}
                        onChange={e =>
                          setEditForms(current => ({
                            ...current,
                            [user.id]: { ...current[user.id], username: e.target.value.toLowerCase() },
                          }))
                        }
                        className="px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600"
                        placeholder="Username"
                      />
                      <input
                        type="text"
                        value={edit.display_name}
                        onChange={e =>
                          setEditForms(current => ({
                            ...current,
                            [user.id]: { ...current[user.id], display_name: e.target.value },
                          }))
                        }
                        className="px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600"
                        placeholder="Display name"
                      />
                      <select
                        value={edit.role}
                        onChange={e => {
                          const role = e.target.value
                          setEditForms(current => ({
                            ...current,
                            [user.id]: {
                              ...current[user.id],
                              role,
                              branch: role === 'admin' ? '' : current[user.id].branch,
                            },
                          }))
                        }}
                        className="px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600 bg-white"
                      >
                        <option value="worker">Worker</option>
                        <option value="manager">Manager</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="admin">Admin</option>
                      </select>
                      <input
                        type="text"
                        value={edit.branch}
                        onChange={e =>
                          setEditForms(current => ({
                            ...current,
                            [user.id]: { ...current[user.id], branch: e.target.value.toUpperCase() },
                          }))
                        }
                        disabled={!roleRequiresBranch(edit.role)}
                        required={roleRequiresBranch(edit.role)}
                        className="px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600 disabled:bg-gray-50 disabled:text-gray-400"
                        placeholder={edit.role === 'admin' ? 'Not required for admins' : 'Home branch'}
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                      <input
                        type="text"
                        value={edit.password}
                        onChange={e =>
                          setEditForms(current => ({
                            ...current,
                            [user.id]: { ...current[user.id], password: e.target.value },
                          }))
                        }
                        className="px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-green-600"
                        placeholder="Optional new password"
                      />
                      <button
                        onClick={() => void saveUser(user.id)}
                        disabled={savingUserId === user.id}
                        className="px-4 py-2.5 rounded-xl text-white font-medium text-sm disabled:opacity-50"
                        style={{ backgroundColor: '#006834' }}
                      >
                        {savingUserId === user.id ? 'Saving…' : 'Save Changes'}
                      </button>
                      <button
                        onClick={() => void deleteUser(user.id, user.username)}
                        disabled={deleting === user.id}
                        className="px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-medium text-sm disabled:opacity-50"
                      >
                        {deleting === user.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
