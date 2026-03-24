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
    const userBranch = profile?.branch?.trim().toUpperCase() || null

    const [
      { count: totalCount, error: countError },
      { count: nullBranchCodeCount },
      { count: systemIdMatchCount },
      { data: branchSample },
      { data: headerSample },
    ] = await Promise.all([
      serviceClient.from('app_po_search').select('*', { count: 'exact', head: true }),
      serviceClient.from('app_po_search').select('*', { count: 'exact', head: true }).is('branch_code', null),
      userBranch
        ? serviceClient.from('app_po_search').select('*', { count: 'exact', head: true }).eq('system_id', userBranch)
        : Promise.resolve({ count: null }),
      serviceClient.from('app_po_search').select('system_id').not('system_id', 'is', null).limit(300),
      serviceClient.from('erp_mirror_po_header').select('*').limit(1),
    ])

    if (countError) {
      return NextResponse.json({
        error: 'Could not query app_po_search',
        detail: countError.message,
      }, { status: 500 })
    }

    const distinctSystemIds = Array.from(
      new Set((branchSample || []).map((r: any) => r.system_id).filter(Boolean))
    ).slice(0, 30)

    const erpPoHeaderColumns = headerSample?.[0]
      ? Object.keys(headerSample[0]).sort()
      : []

    return NextResponse.json({
      userBranch,
      appPoSearch: {
        totalRows: totalCount,
        nullBranchCodeRows: nullBranchCodeCount,
        systemIdMatchRows: systemIdMatchCount,
        distinctSystemIds,
        note: 'system_id is the branch identifier — branch_code column is always NULL in this view',
      },
      erpPoHeaderColumns,
    })
  } catch (error) {
    logError('PO diagnostics error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Diagnostics failed' },
      { status: 500 }
    )
  }
}
