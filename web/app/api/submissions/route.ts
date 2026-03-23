import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logError, logWarn } from '@/lib/logger'

export const dynamic = 'force-dynamic'

async function getSubmissionClients() {
  return {
    authClient: await createClient(),
    serviceClient: createServiceClient(),
  }
}

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient()
    const serviceClient = createServiceClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      logWarn('Unauthorized submission create attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('username, branch')
      .eq('id', user.id)
      .maybeSingle()

    const body = await request.json()
    const {
      po_number,
      image_url,
      image_key,
      image_urls,
      image_keys,
      notes,
      supplier_name,
      supplier_code,
      po_status,
      expect_date,
    } = body

    if (!po_number || (!image_url && !image_urls)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('submissions')
      .insert({
        po_number: po_number.trim().toUpperCase(),
        image_url: image_url || (image_urls?.[0] || null),
        image_key: image_key || (image_keys?.[0] || null),
        image_urls: image_urls || (image_url ? [image_url] : []),
        image_keys: image_keys || (image_key ? [image_key] : []),
        submitted_by: user.id,
        submitted_username: profile?.username || user.email?.split('@')[0],
        branch: profile?.branch,
        notes: notes?.trim() || null,
        status: 'pending',
        supplier_name,
        supplier_code,
        po_status,
        expect_date,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    logError('Submission error', error)
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const authClient = await createClient()
    const serviceClient = createServiceClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      logWarn('Unauthorized submission list attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await authClient
      .from('profiles')
      .select('role, branch')
      .eq('id', user.id)
      .maybeSingle()

    const userRole = profile?.role || user.app_metadata?.role || user.user_metadata?.role
    const userBranch = profile?.branch

    const { searchParams } = new URL(request.url)
    const poSearch = searchParams.get('po_number')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const days = parseInt(searchParams.get('days') || '7')

    let query = serviceClient
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (userRole === 'manager' && userBranch) {
      query = query.eq('branch', userBranch)
    } else if (userRole !== 'supervisor') {
      query = query.eq('submitted_by', user.id)
    }

    if (poSearch) {
      query = query.ilike('po_number', `%${poSearch}%`)
    }

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if ((userRole === 'supervisor' || userRole === 'manager') && !poSearch) {
      const since = new Date()
      since.setDate(since.getDate() - days)
      query = query.gte('created_at', since.toISOString())
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json(data)
  } catch (error) {
    logError('Fetch submissions error', error)
    return NextResponse.json({ error: 'Failed to fetch submissions' }, { status: 500 })
  }
}
