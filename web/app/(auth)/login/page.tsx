'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { emailFromUsername } from '@/lib/utils'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const email = emailFromUsername(username.trim().toLowerCase())

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError('Invalid username or password')
        return
      }

      // Get role to redirect appropriately
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      // Hard redirect so the browser commits auth cookies before the server renders
      window.location.href = profile?.role === 'supervisor' ? '/supervisor' : '/'
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center">
      <div className="mx-auto w-full max-w-sm px-6">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div
            className="mx-auto mb-4 w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold"
            style={{ backgroundColor: '#006834' }}
          >
            PO
          </div>
          <h1 className="text-2xl font-bold text-gray-900">PO Check-In</h1>
          <p className="text-sm text-gray-500 mt-1">Warehouse Photo Tool</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. jeffw"
                required
                className="w-full px-4 py-3 rounded-xl border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent text-base"
                style={{ focusRingColor: '#006834' } as React.CSSProperties}
                onFocus={e => e.target.style.boxShadow = '0 0 0 2px #006834'}
                onBlur={e => e.target.style.boxShadow = 'none'}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-3 rounded-xl border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none text-base"
                onFocus={e => e.target.style.boxShadow = '0 0 0 2px #006834'}
                onBlur={e => e.target.style.boxShadow = 'none'}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-3 px-4 rounded-xl text-white font-semibold text-base transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#006834' }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Contact your supervisor if you need access
        </p>
      </div>
    </div>
  )
}
