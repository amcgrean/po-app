import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  getEnv,
  getSupabasePublicEnv,
  getSupabaseServiceEnvError,
  logEnvironmentHealthOnce,
} from '@/lib/env'
import { logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const MANAGEABLE_ROLES = new Set(['worker', 'manager', 'supervisor', 'admin'])

function getSupabaseKeyHint(message: string): string {
  const normalizedMessage = String(message).toLowerCase()

  return normalizedMessage.includes('invalid api key') || normalizedMessage.includes('invalid jwt')
    ? ' Supabase rejected the server key. In your deployment environment, set SUPABASE_SERVICE_ROLE_KEY (legacy JWT) or SUPABASE_SECRET_KEY (new sb_secret_ key), and make sure it matches NEXT_PUBLIC_SUPABASE_URL.'
    : ''
}

function getSetupApiEnvError(): string | null {
  const { url } = getSupabasePublicEnv()

  if (!url) {
    return 'Missing NEXT_PUBLIC_SUPABASE_URL in the web app environment'
  }

  const serviceEnvError = getSupabaseServiceEnvError()
  if (serviceEnvError) {
    return serviceEnvError
  }

  return null
}

function hasValidSetupSecret(request: NextRequest): boolean {
  const secret = getEnv('SETUP_SECRET')
  if (!secret) {
    return false
  }

  const provided =
    request.nextUrl.searchParams.get('secret') || request.headers.get('x-setup-secret')

  return provided === secret
}

function normalizeBranch(branch: unknown): string | null {
  if (typeof branch !== 'string') return null
  const normalized = branch.trim().toUpperCase()
  return normalized || null
}

function validateUserPayload(payload: {
  username?: unknown
  password?: unknown
  role?: unknown
  branch?: unknown
}) {
  const username = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : ''
  const password = typeof payload.password === 'string' ? payload.password : ''
  const role = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : ''
  const branch = normalizeBranch(payload.branch)

  if (!username || !password || !role) {
    return { error: 'username, password, and role are required' }
  }

  if (!MANAGEABLE_ROLES.has(role)) {
    return { error: `Unsupported role "${role}"` }
  }

  if (role !== 'admin' && !branch) {
    return { error: 'A home branch is required for every non-admin user' }
  }

  return { username, password, role, branch }
}

async function getProfileCount(supabase: any) {
  const { count } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })

  return count ?? 0
}

async function isAuthorizedAdminRequest(request: NextRequest): Promise<boolean> {
  try {
    const authClient = await createClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      return false
    }

    const { data: profile } = await authClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    return profile?.role === 'admin'
  } catch {
    return false
  }
}

async function ensureSetupAccess(request: NextRequest, allowBootstrapCreate = false) {
  const supabase = createServiceClient()

  if (hasValidSetupSecret(request)) {
    return { supabase, access: 'secret' as const }
  }

  if (await isAuthorizedAdminRequest(request)) {
    return { supabase, access: 'admin' as const }
  }

  if (!getEnv('SETUP_SECRET') && allowBootstrapCreate) {
    const count = await getProfileCount(supabase)
    if (count === 0) {
      return { supabase, access: 'bootstrap' as const }
    }
  }

  return null
}

export async function POST(request: NextRequest) {
  logEnvironmentHealthOnce('api-setup-post')

  try {
    const envError = getSetupApiEnvError()
    if (envError) {
      return NextResponse.json({ error: envError }, { status: 500 })
    }

    const access = await ensureSetupAccess(request, true)
    if (!access) {
      return NextResponse.json(
        { error: 'Unauthorized — sign in as an admin or provide a valid setup secret' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validated = validateUserPayload(body)
    if ('error' in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    const displayName =
      typeof body.display_name === 'string' && body.display_name.trim()
        ? body.display_name.trim()
        : null
    const email = `${validated.username}@checkin.internal`

    const { data, error } = await access.supabase.auth.admin.createUser({
      email,
      password: validated.password,
      email_confirm: true,
      user_metadata: {
        username: validated.username,
        display_name: displayName,
        role: validated.role,
        branch: validated.branch,
      },
    })

    if (error) throw error

    await access.supabase
      .from('profiles')
      .update({
        username: validated.username,
        display_name: displayName,
        role: validated.role,
        branch: validated.branch,
      })
      .eq('id', data.user.id)

    return NextResponse.json({ success: true, userId: data.user.id }, { status: 201 })
  } catch (error: any) {
    logError('Create user error', error)

    const message = error?.message || 'Failed to create user'
    const envHint = getSupabaseKeyHint(message)

    return NextResponse.json({ error: `${message}${envHint}` }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  logEnvironmentHealthOnce('api-setup-get')

  try {
    const envError = getSetupApiEnvError()
    if (envError) {
      return NextResponse.json({ error: envError }, { status: 500 })
    }

    const access = await ensureSetupAccess(request)
    if (!access) {
      return NextResponse.json(
        { error: 'Unauthorized — sign in as an admin or provide ?secret=' },
        { status: 401 }
      )
    }

    const { data, error } = await access.supabase
      .from('profiles')
      .select('id, username, display_name, role, branch, created_at')
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json(data)
  } catch (error: any) {
    logError('Fetch setup users error', error)
    const message = error?.message || 'Failed to fetch setup users'
    return NextResponse.json({ error: `${message}${getSupabaseKeyHint(message)}` }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  logEnvironmentHealthOnce('api-setup-patch')

  try {
    const envError = getSetupApiEnvError()
    if (envError) {
      return NextResponse.json({ error: envError }, { status: 500 })
    }

    const access = await ensureSetupAccess(request)
    if (!access) {
      return NextResponse.json(
        { error: 'Unauthorized — sign in as an admin or provide a valid setup secret' },
        { status: 401 }
      )
    }

    const { userId, username, display_name, password, role, branch } = await request.json()

    if (!userId || !username || !role) {
      return NextResponse.json(
        { error: 'userId, username, and role are required' },
        { status: 400 }
      )
    }

    const normalizedRole = String(role).trim().toLowerCase()
    const normalizedBranch = normalizeBranch(branch)

    if (!MANAGEABLE_ROLES.has(normalizedRole)) {
      return NextResponse.json({ error: `Unsupported role "${normalizedRole}"` }, { status: 400 })
    }

    if (normalizedRole !== 'admin' && !normalizedBranch) {
      return NextResponse.json(
        { error: 'A home branch is required for every non-admin user' },
        { status: 400 }
      )
    }

    const authUpdatePayload: {
      password?: string
      user_metadata: {
        username: string
        display_name: string | null
        role: string
        branch: string | null
      }
    } = {
      user_metadata: {
        username: String(username).trim().toLowerCase(),
        display_name:
          typeof display_name === 'string' && display_name.trim()
            ? display_name.trim()
            : null,
        role: normalizedRole,
        branch: normalizedBranch,
      },
    }

    if (typeof password === 'string' && password.trim()) {
      authUpdatePayload.password = password.trim()
    }

    const { error: authUpdateError } = await access.supabase.auth.admin.updateUserById(
      userId,
      authUpdatePayload
    )
    if (authUpdateError) throw authUpdateError

    const { error: profileError } = await access.supabase
      .from('profiles')
      .update({
        username: String(username).trim().toLowerCase(),
        display_name:
          typeof display_name === 'string' && display_name.trim()
            ? display_name.trim()
            : null,
        role: normalizedRole,
        branch: normalizedBranch,
      })
      .eq('id', userId)

    if (profileError) throw profileError

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logError('Reset password error', error)
    const message = error?.message || 'Failed to reset password'
    return NextResponse.json({ error: `${message}${getSupabaseKeyHint(message)}` }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  logEnvironmentHealthOnce('api-setup-delete')

  try {
    const envError = getSetupApiEnvError()
    if (envError) {
      return NextResponse.json({ error: envError }, { status: 500 })
    }

    const access = await ensureSetupAccess(request)
    if (!access) {
      return NextResponse.json(
        { error: 'Unauthorized — sign in as an admin or provide a valid setup secret' },
        { status: 401 }
      )
    }

    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const { error } = await access.supabase.auth.admin.deleteUser(userId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logError('Delete user error', error)
    const message = error?.message || 'Failed to delete user'
    return NextResponse.json({ error: `${message}${getSupabaseKeyHint(message)}` }, { status: 500 })
  }
}
