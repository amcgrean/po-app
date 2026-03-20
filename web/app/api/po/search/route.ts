import { NextRequest, NextResponse } from 'next/server'
import { searchPurchaseOrders } from '@/lib/po/server'
import { logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 25)
    const results = await searchPurchaseOrders(query, Number.isNaN(limit) ? 10 : limit)
    return NextResponse.json({ data: results })
  } catch (error) {
    logError('PO search error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search purchase orders' },
      { status: 500 }
    )
  }
}
