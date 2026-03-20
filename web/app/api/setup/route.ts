import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getEnv,
  getSupabasePublicEnv,
  getSupabaseServiceEnvError,
  logEnvironmentHealthOnce,
} from '@/lib/env'
import { logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'


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

function checkSecret(request: NextRequest): boolean {
  const secret = getEnv('SETUP_SECRET')
  if (!secret) {
    // No secret configured — bootstrap requests are allowed (checked below)
    return true
  }

  const provided =
    request.nextUrl.searchParams.get('secret') || request.headers.get('x-setup-secret')

  return provided === secret
}

/** Returns true when there are zero profiles — i.e. first-time setup with no secret. */
async function isBootstrapAllowed(supabase: any): Promise<boolean> {
  const secret = getEnv('SETUP_SECRET')
  if (secret) return true // secret is configured — normal auth flow applies

  const { count } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })

  return count === 0
}

export async function POST(request: NextRequest) {
  logEnvironmentHealthOnce('api-setup-post')

  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const envError = getSetupApiEnvError()
    if (envError) {
      return NextResponse.json({ error: envError }, { status: 500 })
    }

    const supabase = createServiceClient()

    if (!(await isBootstrapAllowed(supabase))) {
      return NextResponse.json(
        { error: 'SETUP_SECRET required once users exist' },
        { status: 401 }
      )
    }
    const body = await request.json()
    const { username, display_name, password, role, branch } = body

    if (!username || !password || !role) {
      return NextResponse.json(
        { error: 'username, password, and role are required' },
        { status: 400 }
      )
    }

    const email = `${username}@checkin.internal`

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name, role },
    })

    if (error) throw error

    await supabase
      .from('profiles')
      .update({ username, display_name, role, branch })
      .eq('id', data.user.id)

    return NextResponse.json({ success: true, userId: data.user.id }, { status: 201 })
  } catch (error: any) {
    logError('Create user error', error)

    const message = error?.message || 'Failed to create user'
    const normalizedMessage = String(message).toLowerCase()
    const envHint =
      normalizedMessage.includes('invalid api key') || normalizedMessage.includes('invalid jwt')
        ? ' Supabase rejected the server key. In your deployment environment, set SUPABASE_SERVICE_ROLE_KEY (legacy JWT) or SUPABASE_SECRET_KEY (new secret key), and make sure it is not the public anon/publishable key.'
        : ''

    return NextResponse.json(
      { error: `${message}${envHint}` },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  logEnvironmentHealthOnce('api-setup-get')

  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized — provide ?secret= or x-setup-secret header' }, { status: 401 })
  }

  try {
    const envError = getSetupApiEnvError()
    if (envError) {
      return NextResponse.json({ error: envError }, { status: 500 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, role, branch, created_at')
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json(data)
  } catch (error: any) {
    logError('Fetch setup users error', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  logEnvironmentHealthOnce('api-setup-patch')

  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const envError = getSetupApiEnvError()
    if (envError) {
      return NextResponse.json({ error: envError }, { status: 500 })
    }

    const supabase = createServiceClient()
    const { userId, password } = await request.json()

    if (!userId || !password) {
      return NextResponse.json({ error: 'userId and password are required' }, { status: 400 })
    }

    const { error } = await supabase.auth.admin.updateUserById(userId, { password })
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logError('Reset password error', error)
    return NextResponse.json({ error: error.message || 'Failed to reset password' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  logEnvironmentHealthOnce('api-setup-delete')

  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const envError = getSetupApiEnvError()
    if (envError) {
      return NextResponse.json({ error: envError }, { status: 500 })
    }

    const supabase = createServiceClient()
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const { error } = await supabase.auth.admin.deleteUser(userId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logError('Delete user error', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
