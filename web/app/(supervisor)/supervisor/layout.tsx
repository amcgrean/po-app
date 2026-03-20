import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SignOutClient from './SignOutClient'

export const dynamic = 'force-dynamic'

export default async function SupervisorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('username, display_name').eq('id', user.id).single()
    : { data: null }

  const displayName = profile?.display_name || profile?.username || 'Supervisor'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white shadow-sm" style={{ backgroundColor: '#006834' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/supervisor" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center text-sm font-bold">
                PO
              </div>
              <span className="font-bold text-lg hidden sm:block">PO Check-In</span>
            </Link>
            <span className="text-white/50 hidden sm:block">|</span>
            <span className="text-white/80 text-sm hidden sm:block">Supervisor Portal</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-white/80 text-sm hidden sm:block">{displayName}</span>
            <SignOutClient />
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
