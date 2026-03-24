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

    // ── app_po_search diagnostics ────────────────────────────────────────────
    const { count: totalCount, error: countError } = await serviceClient
      .from('app_po_search')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      return NextResponse.json({
        error: 'Could not query app_po_search',
        detail: countError.message,
      }, { status: 500 })
    }

    const [
      { count: nullBranchCount },
      { count: branchMatchCount },
      { data: branchSample },
    ] = await Promise.all([
      serviceClient.from('app_po_search').select('*', { count: 'exact', head: true }).is('branch_code', null),
      userBranch
        ? serviceClient.from('app_po_search').select('*', { count: 'exact', head: true }).eq('branch_code', userBranch)
        : Promise.resolve({ count: null }),
      serviceClient.from('app_po_search').select('branch_code').not('branch_code', 'is', null).limit(200),
    ])

    const distinctBranchCodes = Array.from(
      new Set((branchSample || []).map((r: any) => r.branch_code).filter(Boolean))
    ).slice(0, 20)

    // ── erp_mirror_po_header column probe ────────────────────────────────────
    // Fetch one row with all columns so we can see what fields exist and spot
    // anything branch-related that the view might be able to use.
    const { data: headerSample, error: headerError } = await serviceClient
      .from('erp_mirror_po_header')
      .select('*')
      .limit(1)

    const erpPoHeaderColumns = headerSample?.[0]
      ? Object.keys(headerSample[0]).sort()
      : headerError
        ? { error: headerError.message }
        : []

    const branchLikeColumns = Array.isArray(erpPoHeaderColumns)
      ? erpPoHeaderColumns.filter((c: string) =>
          c.toLowerCase().includes('branch') ||
          c.toLowerCase().includes('location') ||
          c.toLowerCase().includes('loc') ||
          c.toLowerCase().includes('site') ||
          c.toLowerCase().includes('store') ||
          c.toLowerCase().includes('division')
        )
      : []

    // Sample values for any branch-like columns found
    let branchColumnSamples: Record<string, unknown[]> = {}
    if (branchLikeColumns.length > 0) {
      const colList = branchLikeColumns.join(', ')
      const { data: samples } = await serviceClient
        .from('erp_mirror_po_header')
        .select(colList)
        .limit(10)

      branchColumnSamples = branchLikeColumns.reduce((acc: Record<string, unknown[]>, col: string) => {
        acc[col] = Array.from(new Set((samples || []).map((r: any) => r[col]).filter(v => v != null))).slice(0, 10)
        return acc
      }, {})
    }

    return NextResponse.json({
      userBranch,
      appPoSearch: {
        totalRows: totalCount,
        nullBranchCodeRows: nullBranchCount,
        branchMatchRows: branchMatchCount,
        distinctBranchCodes,
      },
      erpPoHeader: {
        allColumns: erpPoHeaderColumns,
        branchLikeColumns,
        branchColumnSamples,
      },
    })
  } catch (error) {
    logError('PO diagnostics error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Diagnostics failed' },
      { status: 500 }
    )
  }
}
