import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logError, logWarn } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authClient = await createClient()
    const serviceClient = createServiceClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      logWarn('Unauthorized submission detail attempt', { submissionId: params.id })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await authClient
      .from('profiles')
      .select('role, branch')
      .eq('id', user.id)
      .maybeSingle()

    const { data, error } = await serviceClient
      .from('submissions')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const userRole = profile?.role || user.app_metadata?.role || user.user_metadata?.role
    const userBranch = profile?.branch
    const isOwner = data.submitted_by === user.id
    const isSupervisor = userRole === 'supervisor'
    const isBranchManager = userRole === 'manager' && userBranch && userBranch === data.branch

    if (!isOwner && !isSupervisor && !isBranchManager) {
      logWarn('Forbidden submission detail access attempt', {
        submissionId: params.id,
        userId: user.id,
        role: userRole,
        branch: userBranch,
        submissionBranch: data.branch,
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(data)
  } catch (error) {
    logError('Fetch submission error', error, { submissionId: params.id })
    return NextResponse.json({ error: 'Failed to fetch submission' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authClient = await createClient()
    const serviceClient = createServiceClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      logWarn('Unauthorized submission patch attempt', { submissionId: params.id })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await authClient
      .from('profiles')
      .select('role, branch')
      .eq('id', user.id)
      .maybeSingle()

    const { data: submission } = await serviceClient
      .from('submissions')
      .select('branch')
      .eq('id', params.id)
      .single()

    if (!submission) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const userRole = profile?.role || user.app_metadata?.role || user.user_metadata?.role
    const userBranch = profile?.branch
    const isSupervisor = userRole === 'supervisor'
    const isBranchManager = userRole === 'manager' && userBranch && userBranch === submission.branch

    if (!isSupervisor && !isBranchManager) {
      logWarn('Forbidden submission patch attempt', {
        submissionId: params.id,
        userId: user.id,
        role: userRole,
        branch: userBranch,
        submissionBranch: submission.branch,
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { status, reviewer_notes } = body

    const { data: updated, error: updateError } = await serviceClient
      .from('submissions')
      .update({
        status,
        reviewer_notes: reviewer_notes?.trim() || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) throw updateError

    return NextResponse.json(updated)
  } catch (error) {
    logError('Update submission error', error, { submissionId: params.id })
    return NextResponse.json({ error: 'Failed to update submission' }, { status: 500 })
  }
}
