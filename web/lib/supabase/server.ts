import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getEnv, getSupabasePublicEnv, logEnvironmentHealthOnce } from '@/lib/env'
import { logWarn } from '@/lib/logger'

export async function createClient() {
  logEnvironmentHealthOnce('supabase-server-createClient')

  const { url, anonKey } = getSupabasePublicEnv()
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          logWarn('Unable to set cookies in server component; middleware will handle refresh')
        }
      },
    },
  })
}

export function createServiceClient() {
  logEnvironmentHealthOnce('supabase-server-createServiceClient')

  const { url } = getSupabasePublicEnv()
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const { createClient } = require('@supabase/supabase-js')
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
