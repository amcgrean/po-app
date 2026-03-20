import { NextRequest, NextResponse } from 'next/server'
import { getPurchaseOrder } from '@/lib/po/server'
import { logError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { poNumber: string } }
) {
  try {
    const poNumber = params.poNumber?.trim()
    if (!poNumber) {
      return NextResponse.json({ error: 'Missing PO number' }, { status: 400 })
    }

    const result = await getPurchaseOrder(poNumber)
    if (!result) {
      return NextResponse.json({ error: 'PO not found' }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('PO detail error', error, { poNumber: params.poNumber })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load purchase order' },
      { status: 500 }
    )
  }
}
