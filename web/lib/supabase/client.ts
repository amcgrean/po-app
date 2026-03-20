import { createBrowserClient } from '@supabase/ssr'
import { getSupabasePublicEnv, logEnvironmentHealthOnce } from '@/lib/env'

export function createClient() {
  logEnvironmentHealthOnce('supabase-browser-createClient')

  const { url, anonKey } = getSupabasePublicEnv()
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  return createBrowserClient(url, anonKey)
}
