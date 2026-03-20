'use client'

import { useState, useCallback, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import type { PoHeaderRow } from '@/lib/po/types'

const BarcodeScanner = dynamic(() => import('@/components/BarcodeScanner'), { ssr: false })
const CameraCapture = dynamic(() => import('@/components/CameraCapture'), { ssr: false })

type Step = 'idle' | 'scanning' | 'camera' | 'done'
type PoLookupState = 'idle' | 'loading' | 'found' | 'missing' | 'error'

export default function WorkerPage() {
  const [step, setStep] = useState<Step>('idle')
  const [poNumber, setPoNumber] = useState('')
  const [poInput, setPoInput] = useState('')
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [poError, setPoError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [poLookupState, setPoLookupState] = useState<PoLookupState>('idle')
  const [poLookupMessage, setPoLookupMessage] = useState<string | null>(null)
  const [poHeader, setPoHeader] = useState<PoHeaderRow | null>(null)

  useEffect(() => {
    async function loadUser() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, display_name')
          .eq('id', user.id)
          .single()
        setUsername(profile?.display_name || profile?.username || '')
      }
    }
    loadUser()
  }, [])

  useEffect(() => {
    if (!poNumber || poNumber.length < 6 || poNumber.length > 10) {
      setPoLookupState('idle')
      setPoLookupMessage(null)
      setPoHeader(null)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function loadPurchaseOrder() {
      setPoLookupState('loading')
      setPoLookupMessage(null)

      try {
        const response = await fetch(`/api/po/${poNumber}`, {
          signal: controller.signal,
          cache: 'no-store',
        })

        if (cancelled) {
          return
        }

        if (response.status === 404) {
          setPoLookupState('missing')
          setPoLookupMessage('PO was not found in the shared ERP mirror.')
          setPoHeader(null)
          return
        }

        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || 'PO lookup failed')
        }

        setPoLookupState('found')
        setPoHeader(payload.header || null)
      } catch (lookupError: any) {
        if (lookupError?.name === 'AbortError' || cancelled) {
          return
        }

        setPoLookupState('error')
        setPoLookupMessage(
          lookupError?.message || 'Shared PO lookup is not ready yet. You can still continue with a manual PO number.'
        )
        setPoHeader(null)
      }
    }

    const timeoutId = window.setTimeout(loadPurchaseOrder, 250)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [poNumber])

  const handleBarcodeScan = useCallback((value: string) => {
    const digits = value.trim().replace(/\D/g, '')
    if (/^\d{6,10}$/.test(digits)) {
      setPoNumber(digits)
      setPoInput(digits)
      setPoError(null)
    } else {
      setPoError(`Barcode must be 6–10 digits (got "${value.trim()}"). Please scan again.`)
    }
    setStep('idle')
  }, [])

  const handlePoInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '')
    setPoInput(val)
    if (val.length === 0) {
      setPoError(null)
      setPoNumber('')
    } else if (val.length < 6) {
      setPoError(`PO number must be at least 6 digits (${val.length} entered)`)
      setPoNumber('')
    } else if (val.length > 10) {
      setPoError('PO number must be at most 10 digits')
      setPoNumber('')
    } else {
      setPoError(null)
      setPoNumber(val)
    }
  }

  const handlePhotoCapture = useCallback((files: File[]) => {
    const newPhotos = files.map(file => ({
      file,
      preview: URL.createObjectURL(file)
    }))
    setPhotos(prev => [...prev, ...newPhotos])
    setStep('idle')
  }, [])

  const clearPo = () => {
    setPoNumber('')
    setPoInput('')
    setPoError(null)
    setPoLookupState('idle')
    setPoLookupMessage(null)
    setPoHeader(null)
  }

  const removePhoto = (index: number) => {
    setPhotos(prev => {
      const next = [...prev]
      URL.revokeObjectURL(next[index].preview)
      next.splice(index, 1)
      return next
    })
  }

  const clearPhotos = () => {
    photos.forEach(p => URL.revokeObjectURL(p.preview))
    setPhotos([])
  }

  const reset = () => {
    clearPhotos()
    setPoNumber('')
    setPoInput('')
    setNotes('')
    setError(null)
    setPoError(null)
    setSuccess(false)
  }

  async function handleSubmit() {
    if (!poNumber || photos.length === 0) return
    setSubmitting(true)
    setError(null)

    try {
      // 1. Upload all images in parallel
      const uploadPromises = photos.map(async ({ file }) => {
        const formData = new FormData()
        formData.append('image', file)
        formData.append('po_number', poNumber)

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Upload failed')
        }

        return res.json() as Promise<{ url: string; key: string }>
      })

      const uploadResults = await Promise.all(uploadPromises)
      const imageUrls = uploadResults.map(r => r.url)
      const imageKeys = uploadResults.map(r => r.key)

      // 2. Create submission record with arrays
      const submitRes = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          po_number: poNumber,
          image_url: imageUrls[0], // backward compatibility
          image_key: imageKeys[0], // backward compatibility
          image_urls: imageUrls,
          image_keys: imageKeys,
          notes: notes.trim() || null,
          // Shared ERP metadata (optional but powerful for record keeping)
          supplier_name: poHeader?.supplier_name || null,
          supplier_code: poHeader?.supplier_key || null,
          po_status: poHeader?.po_status || null,
          expect_date: poHeader?.expect_date || null,
        }),
      })

      if (!submitRes.ok) {
        const err = await submitRes.json()
        throw new Error(err.error || 'Submission failed')
      }

      setSuccess(true)
      setStep('done')

      // Auto-reset after 3 seconds
      setTimeout(() => {
        reset()
        setStep('idle')
      }, 3000)
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // Scanner overlay
  if (step === 'scanning') {
    return (
      <BarcodeScanner
        onScan={handleBarcodeScan}
        onClose={() => setStep('idle')}
      />
    )
  }

  // Camera overlay
  if (step === 'camera') {
    return (
      <CameraCapture
        onCapture={handlePhotoCapture}
        onClose={() => setStep('idle')}
      />
    )
  }

  // Success screen
  if (success) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center mb-6 text-5xl"
          style={{ backgroundColor: '#e8f5ee' }}
        >
          ✓
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Submitted!</h2>
        <p className="text-lg text-gray-600">
          PO <span className="font-bold" style={{ color: '#006834' }}>{poNumber}</span>
        </p>
        <p className="text-sm text-gray-400 mt-4">Resetting in a moment…</p>
      </div>
    )
  }

  const canSubmit = !!poNumber && photos.length > 0 && !submitting

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-4 py-4 safe-top" style={{ backgroundColor: '#006834' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">PO Check-In</h1>
            {username && (
              <p className="text-sm text-white/70">Hi, {username}</p>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="text-white/70 text-sm active:text-white"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="px-4 py-6 space-y-4 max-w-lg mx-auto">
        {/* Step 1: PO Number */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: poNumber ? '#006834' : '#6b7280' }}
            >
              {poNumber ? '✓' : '1'}
            </div>
            <h2 className="font-semibold text-gray-800">PO Number</h2>
          </div>

          {poNumber ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ backgroundColor: '#e8f5ee' }}>
                <span className="font-bold text-xl" style={{ color: '#006834' }}>{poNumber}</span>
                <button onClick={clearPo} className="text-sm text-gray-500 underline">Clear</button>
              </div>

              {poLookupState === 'loading' && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  Looking up PO details from the shared ERP mirror...
                </div>
              )}

              {poHeader && poLookupState === 'found' && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-gray-700 space-y-1">
                  <div className="font-semibold text-green-900">
                    {poHeader.supplier_name || 'Supplier not available'}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                    <span>Status: {poHeader.po_status || 'Unknown'}</span>
                    <span>Expected: {poHeader.expect_date ? formatDate(poHeader.expect_date) : 'N/A'}</span>
                    <span>Lines: {poHeader.line_count ?? 0}</span>
                    <span>Receipts: {poHeader.receipt_count ?? 0}</span>
                  </div>
                </div>
              )}

              {poLookupMessage && poLookupState !== 'loading' && (
                <div className={`rounded-xl px-4 py-3 text-sm ${
                  poLookupState === 'missing'
                    ? 'border border-amber-200 bg-amber-50 text-amber-800'
                    : 'border border-gray-200 bg-gray-50 text-gray-600'
                }`}>
                  {poLookupMessage}
                </div>
              )}
            </div>
          ) : (
            <>
              <button
                onClick={() => setStep('scanning')}
                className="w-full py-4 rounded-xl text-white text-base font-semibold mb-3 active:opacity-90"
                style={{ backgroundColor: '#006834' }}
              >
                <span className="text-xl mr-2">▦</span>
                Scan Barcode
              </button>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={poInput}
                  onChange={handlePoInputChange}
                  placeholder="Or type PO number (6–10 digits)"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base text-gray-800 placeholder-gray-400 focus:outline-none"
                  onFocus={e => e.target.style.borderColor = '#006834'}
                  onBlur={e => e.target.style.borderColor = '#d1d5db'}
                  maxLength={10}
                />
              </div>
              {poError && (
                <p className="text-red-600 text-sm mt-2 px-1">{poError}</p>
              )}
            </>
          )}
        </div>

        {/* Step 2: Photos */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: photos.length > 0 ? '#006834' : (poNumber ? '#6b7280' : '#d1d5db') }}
            >
              {photos.length > 0 ? '✓' : '2'}
            </div>
            <h2 className={`font-semibold ${poNumber ? 'text-gray-800' : 'text-gray-400'}`}>
              Attach Photos {photos.length > 0 && `(${photos.length})`}
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative aspect-square">
                <img
                  src={p.preview}
                  alt=""
                  className="w-full h-full object-cover rounded-xl"
                />
                <button
                  onClick={() => removePhoto(i)}
                  className="absolute -top-1 -right-1 bg-red-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border border-white"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => setStep('camera')}
              disabled={!poNumber}
              className="aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-colors disabled:opacity-40"
              style={{
                borderColor: poNumber ? '#006834' : '#d1d5db',
                color: poNumber ? '#006834' : '#9ca3af',
              }}
            >
              <span className="text-2xl mb-1">📷</span>
              <span className="text-xs font-semibold">Add</span>
            </button>
          </div>
        </div>

        {/* Step 3: Submit */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: canSubmit ? '#006834' : '#d1d5db' }}
            >
              3
            </div>
            <h2 className={`font-semibold ${canSubmit ? 'text-gray-800' : 'text-gray-400'}`}>
              Submit
            </h2>
          </div>

          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes (damage, quantity, etc.)"
            rows={2}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none resize-none mb-3"
            onFocus={e => e.target.style.borderColor = '#006834'}
            onBlur={e => e.target.style.borderColor = '#d1d5db'}
          />

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-3">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-4 rounded-xl text-white text-base font-bold transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ backgroundColor: '#006834' }}
          >
            {submitting ? (
              <>
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing {photos.length} photos…
              </>
            ) : (
              'Submit Check-In'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
