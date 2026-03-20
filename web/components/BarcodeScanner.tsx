'use client'

import { useEffect, useRef, useState } from 'react'

interface BarcodeScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(true)
  const scannerRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const containerId = 'html5qr-reader'

  useEffect(() => {
    mountedRef.current = true

    async function startScanner() {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')

        const scanner = new Html5Qrcode(containerId, {
          verbose: false,
        })
        scannerRef.current = scanner

        // Define a responsive qrbox function.
        // It should be based on the smaller dimension to ensure it fits.
        const qrboxFunction = (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
          const qrboxSize = Math.floor(minEdge * 0.7)
          return {
            width: qrboxSize,
            height: Math.floor(qrboxSize * 0.6), // Maintain a rectangular aspect for barcodes
          }
        }

        await scanner.start(
          { facingMode: 'environment' },
          { 
            fps: 10, 
            qrbox: qrboxFunction,
            aspectRatio: 1.0 // Force a square-ish aspect for the video stream if possible
          },
          (decodedText: string) => {
            if (!mountedRef.current) return

            // Beep feedback
            try {
              const AudioContext = window.AudioContext || (window as any).webkitAudioContext
              const ctx = new AudioContext()
              const osc = ctx.createOscillator()
              const gain = ctx.createGain()
              osc.connect(gain)
              gain.connect(ctx.destination)
              osc.frequency.value = 880
              gain.gain.value = 0.1
              osc.start()
              osc.stop(ctx.currentTime + 0.1)
            } catch (e) {
              // Ignore audio errors
            }

            onScan(decodedText)
          },
          () => {
            // Per-frame error — normal when no barcode visible, ignore
          }
        )

        if (mountedRef.current) setIsStarting(false)
      } catch (err: any) {
        if (!mountedRef.current) return

        const name = err?.name || ''
        const msg = (err?.message || String(err)).toLowerCase()

        if (name === 'NotAllowedError' || msg.includes('permission') || msg.includes('notallowed')) {
          setError(
            'Camera access was denied. Go to your browser settings, allow camera for this site, then reload.'
          )
        } else if (name === 'NotFoundError' || msg.includes('notfound')) {
          setError('No camera found on this device.')
        } else {
          setError('Could not start camera. Please try again.')
        }
        setIsStarting(false)
      }
    }

    startScanner()

    return () => {
      mountedRef.current = false
      const scanner = scannerRef.current
      if (scanner) {
        scanner.stop().catch(() => {}).finally(() => {
          scanner.clear().catch(() => {})
        })
      }
    }
  }, [onScan])

  const handleFileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !scannerRef.current) return

    try {
      setIsStarting(true)
      const result = await scannerRef.current.scanFile(file, true)
      if (mountedRef.current) {
        onScan(result)
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setError('Could not find a barcode in that photo. Please try another or use the live camera.')
      }
    } finally {
      if (mountedRef.current) {
        setIsStarting(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black safe-top">
        <h2 className="text-white text-lg font-semibold">Scan Barcode</h2>
        <button
          onClick={onClose}
          className="text-white text-3xl leading-none w-10 h-10 flex items-center justify-center rounded-full active:bg-white/20"
          aria-label="Close scanner"
        >
          ×
        </button>
      </div>

      {/* Scanner area */}
      <div className="flex-1 flex flex-col items-center justify-center bg-black">
        {error ? (
          <div className="px-6 text-center">
            <div className="text-5xl mb-4">📷</div>
            <p className="text-white text-base">{error}</p>
            <button
              onClick={onClose}
              className="mt-6 px-6 py-3 bg-white text-gray-900 rounded-xl font-semibold"
            >
              Go Back
            </button>
          </div>
        ) : (
          <>
            <div id={containerId} className="w-full max-w-sm overflow-hidden rounded-xl bg-gray-900" style={{ minHeight: '300px' }} />
            <p className="text-white/70 text-sm mt-6 px-4 text-center">
              {isStarting ? 'Starting camera…' : 'Center the barcode in the rectangle'}
            </p>
          </>
        )}
      </div>

      {/* Footer hint */}
      {!error && (
        <div className="px-4 py-6 bg-black safe-bottom flex flex-col items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-white/80 text-sm font-medium border border-white/20 px-6 py-2 rounded-full active:bg-white/10 transition-colors"
          >
            Scan from Photo
          </button>
          <p className="text-white/40 text-[10px] text-center uppercase tracking-widest">
            Supports Code 128, Code 39, QR, EAN, UPC
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileScan}
          />
        </div>
      )}
    </div>
  )
}
