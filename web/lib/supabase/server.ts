import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  getSupabasePublicEnv,
  getSupabaseServiceEnv,
  getSupabaseServiceEnvError,
  logEnvironmentHealthOnce,
} from '@/lib/env'
import { logWarn } from '@/lib/logger'

export async function createClient() {
  logEnvironmentHealthOnce('supabase-server-createClient')

  const { url, anonKey } = getSupabasePublicEnv()
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or a public Supabase key (NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)')
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
  const { serviceKey } = getSupabaseServiceEnv()
  const serviceEnvError = getSupabaseServiceEnvError()

  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or a server Supabase key (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY)'
    )
  }

  if (serviceEnvError) {
    throw new Error(serviceEnvError)
  }

  const { createClient } = require('@supabase/supabase-js')
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
