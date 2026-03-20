import { logInfo, logWarn } from './logger'

let hasLoggedEnvironment = false

function normalizeEnvValue(rawValue: string | undefined): string | undefined {
  if (typeof rawValue !== 'string') {
    return undefined
  }

  const trimmedValue = rawValue.trim()
  if (!trimmedValue) {
    return undefined
  }

  const hasMatchingQuotes =
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))

  const normalizedValue = hasMatchingQuotes
    ? trimmedValue.slice(1, -1).trim()
    : trimmedValue

  return normalizedValue || undefined
}

function readEnv(name: string): string | undefined {
  return normalizeEnvValue(process.env[name])
}

export function getEnv(name: string): string | undefined {
  return readEnv(name)
}

export function getSupabasePublicEnv() {
  // We use direct process.env access here so Next.js can inline these values
  // during the build process for the browser.
  const url = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const anonKey = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const publishableKey = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)

  return {
    url,
    anonKey: anonKey || publishableKey,
    keySource: anonKey
      ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
      : publishableKey
        ? 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
        : undefined,
  }
}

export function hasSupabasePublicEnv() {
  const { url, anonKey } = getSupabasePublicEnv()
  return Boolean(url && anonKey)
}

export function logEnvironmentHealthOnce(source: string) {
  if (hasLoggedEnvironment) {
    return
  }

  const { url, anonKey, keySource } = getSupabasePublicEnv()
  const serviceRole = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  const setupSecret = readEnv('SETUP_SECRET')

  logInfo(`Environment health snapshot from ${source}`, {
    hasSupabaseUrl: Boolean(url),
    hasSupabaseAnonKey: Boolean(anonKey),
    supabasePublicKeySource: keySource || null,
    hasServiceRoleKey: Boolean(serviceRole),
    hasSetupSecret: Boolean(setupSecret),
  })

  if (!url || !anonKey) {
    logWarn('Missing public Supabase env vars; auth-dependent flows may fail')
  }

  hasLoggedEnvironment = true
}
