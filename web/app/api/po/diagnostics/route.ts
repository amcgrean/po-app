import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  try {
    const authClient = await createClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await authClient
      .from('profiles')
      .select('role, branch')
      .eq('id', user.id)
      .maybeSingle()

    const role = profile?.role
    if (!role || !['admin', 'supervisor', 'manager'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const serviceClient = createServiceClient()

    // Total row count in app_po_search
    const { count: totalCount, error: countError } = await serviceClient
      .from('app_po_search')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      return NextResponse.json({
        error: 'Could not query app_po_search',
        detail: countError.message,
      }, { status: 500 })
    }

    // Distinct branch_code values (sample up to 20)
    const { data: branchSample, error: branchError } = await serviceClient
      .from('app_po_search')
      .select('branch_code')
      .not('branch_code', 'is', null)
      .limit(200)

    const distinctBranchCodes = branchError
      ? null
      : Array.from(new Set((branchSample || []).map((r: any) => r.branch_code).filter(Boolean))).slice(0, 20)

    // Count where branch_code is null
    const { count: nullBranchCount, error: nullCountError } = await serviceClient
      .from('app_po_search')
      .select('*', { count: 'exact', head: true })
      .is('branch_code', null)

    // Count for the user's branch specifically
    const userBranch = profile?.branch?.trim().toUpperCase() || null
    let branchMatchCount: number | null = null
    if (userBranch) {
      const { count, error: matchError } = await serviceClient
        .from('app_po_search')
        .select('*', { count: 'exact', head: true })
        .eq('branch_code', userBranch)

      if (!matchError) {
        branchMatchCount = count
      }
    }

    return NextResponse.json({
      userBranch,
      totalRowsInView: totalCount,
      nullBranchCodeCount: nullCountError ? null : nullBranchCount,
      branchMatchCount,
      distinctBranchCodeSample: distinctBranchCodes,
    })
  } catch (error) {
    logError('PO diagnostics error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Diagnostics failed' },
      { status: 500 }
    )
  }
}
