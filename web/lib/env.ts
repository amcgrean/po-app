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

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  try {
    const payload = parts[1]
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const decoded = atob(padded)
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

function isSupabaseSecretKey(token: string): boolean {
  return token.startsWith('sb_secret_')
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

export function getSupabaseServiceEnv() {
  const legacyServiceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  const secretKey = readEnv('SUPABASE_SECRET_KEY')
  const serviceKey = legacyServiceRoleKey || secretKey

  const jwtPayload = serviceKey ? parseJwtPayload(serviceKey) : null
  const jwtRole = typeof jwtPayload?.role === 'string' ? jwtPayload.role : undefined

  return {
    serviceKey,
    keySource: legacyServiceRoleKey
      ? 'SUPABASE_SERVICE_ROLE_KEY'
      : secretKey
        ? 'SUPABASE_SECRET_KEY'
        : undefined,
    isLegacyJwt: Boolean(serviceKey && serviceKey.split('.').length === 3),
    jwtRole,
  }
}

export function getSupabaseServiceEnvError() {
  const { serviceKey, keySource, isLegacyJwt, jwtRole } = getSupabaseServiceEnv()

  if (!serviceKey) {
    return 'Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY in the web app environment'
  }

  if (isLegacyJwt && jwtRole && jwtRole !== 'service_role') {
    return `${keySource} contains a ${jwtRole} JWT. Use the server-only service_role/secret key instead of the anon/publishable key.`
  }

  if (!isLegacyJwt && !isSupabaseSecretKey(serviceKey)) {
    return `${keySource} is present but does not look like a valid Supabase server key. Use the legacy service_role JWT in SUPABASE_SERVICE_ROLE_KEY or the new sb_secret_ key in SUPABASE_SECRET_KEY, and make sure it matches NEXT_PUBLIC_SUPABASE_URL.`
  }

  return null
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
  const { serviceKey, keySource: serviceKeySource, jwtRole } = getSupabaseServiceEnv()
  const setupSecret = readEnv('SETUP_SECRET')

  logInfo(`Environment health snapshot from ${source}`, {
    hasSupabaseUrl: Boolean(url),
    hasSupabaseAnonKey: Boolean(anonKey),
    supabasePublicKeySource: keySource || null,
    hasServiceRoleKey: Boolean(serviceKey),
    supabaseServiceKeySource: serviceKeySource || null,
    supabaseServiceJwtRole: jwtRole || null,
    hasSetupSecret: Boolean(setupSecret),
  })

  if (!url || !anonKey) {
    logWarn('Missing public Supabase env vars; auth-dependent flows may fail')
  }

  if (serviceKeySource && jwtRole && jwtRole !== 'service_role') {
    logWarn('Supabase service key env appears to contain a non-service JWT', {
      supabaseServiceKeySource: serviceKeySource,
      supabaseServiceJwtRole: jwtRole,
    })
  }

  if (serviceKeySource && serviceKey && !jwtRole && !isSupabaseSecretKey(serviceKey)) {
    logWarn('Supabase service key env appears malformed or mismatched for this project', {
      supabaseServiceKeySource: serviceKeySource,
    })
  }

  hasLoggedEnvironment = true
}
