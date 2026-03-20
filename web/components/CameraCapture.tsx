'use client'

import { useRef, useState, useCallback } from 'react'
import imageCompression from 'browser-image-compression'

interface CameraCaptureProps {
  onCapture: (files: File[]) => void
  onClose: () => void
}

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'camera' | 'fallback'>('camera')
  const [capturedFiles, setCapturedFiles] = useState<{ file: File; preview: string }[]>([])
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => setCameraReady(true)
      }
    } catch (err: any) {
      const isDenied =
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError' ||
        err?.message?.toLowerCase().includes('permission')
      if (isDenied) {
        setError(
          'Camera access was denied. On iPhone, go to Settings > Safari > Camera and set it to "Allow", then reload the page.'
        )
      }
      setMode('fallback')
    }
  }, [])

  const handleCameraStart = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && !streamRef.current) {
        startCamera()
      }
    },
    [startCamera]
  )

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  async function compressImage(file: File): Promise<File> {
    return imageCompression(file, {
      maxWidthOrHeight: 1600,
      initialQuality: 0.7,
      useWebWorker: true,
      fileType: 'image/jpeg',
    })
  }

  async function captureFromVideo() {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)

    canvas.toBlob(async (blob) => {
      if (!blob) return
      setIsProcessing(true)
      const rawFile = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const compressed = await compressImage(rawFile)
      const url = URL.createObjectURL(compressed)
      setCapturedFiles(prev => [...prev, { file: compressed, preview: url }])
      setIsProcessing(false)
    }, 'image/jpeg', 0.85)
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    
    setIsProcessing(true)
    setError(null)
    try {
      const processed = await Promise.all(
        files.map(async (file) => {
          const compressed = await compressImage(file)
          return { file: compressed, preview: URL.createObjectURL(compressed) }
        })
      )
      setCapturedFiles(prev => [...prev, ...processed])
    } catch {
      setError('Failed to process some images. Please try again.')
    } finally {
      setIsProcessing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removePhoto(index: number) {
    setCapturedFiles(prev => {
      const next = [...prev]
      URL.revokeObjectURL(next[index].preview)
      next.splice(index, 1)
      return next
    })
  }

  function confirmPhotos() {
    if (capturedFiles.length > 0) {
      stopCamera()
      onCapture(capturedFiles.map(f => f.file))
    }
  }

  function handleClose() {
    stopCamera()
    capturedFiles.forEach(f => URL.revokeObjectURL(f.preview))
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black safe-top">
        <h2 className="text-white text-lg font-semibold">
          {capturedFiles.length > 0 ? `Photos (${capturedFiles.length})` : 'Take Photo'}
        </h2>
        <button
          onClick={handleClose}
          className="text-white text-3xl leading-none w-10 h-10 flex items-center justify-center rounded-full active:bg-white/20"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center bg-black overflow-hidden relative">
        {mode === 'camera' ? (
          <>
            <video
              ref={(el) => {
                ;(videoRef as any).current = el
                handleCameraStart(el)
              }}
              autoPlay
              playsInline
              muted
              className="max-w-full max-h-full object-contain"
            />
            {!cameraReady && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-white/70 text-sm">Starting camera…</p>
              </div>
            )}
          </>
        ) : (
          <div className="px-6 text-center">
            <div className="text-5xl mb-4">🖼️</div>
            {error ? (
              <p className="text-red-400 text-base mb-6">{error}</p>
            ) : (
              <p className="text-white text-base mb-6">
                Tap below to choose photos from your gallery
              </p>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-white text-gray-900 rounded-xl font-semibold text-base active:scale-95 transition-transform"
            >
              Choose Photos
            </button>
          </div>
        )}

        {isProcessing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
            <div className="bg-white rounded-2xl p-4 flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-green-700" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm font-medium">Processing…</span>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />

        {/* Gallery Preview Strip */}
        {capturedFiles.length > 0 && (
          <div className="absolute bottom-4 left-0 right-0 px-4">
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {capturedFiles.map((f, i) => (
                <div key={i} className="relative flex-shrink-0">
                  <img src={f.preview} className="w-16 h-16 object-cover rounded-lg border border-white/20" alt="" />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute -top-1 -right-1 bg-red-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border border-black shadow"
                  >
                    ×
                  </button>
                </div>
              ))}
              {mode === 'camera' && (
                <button
                  onClick={() => setMode('fallback')}
                  className="w-16 h-16 rounded-lg bg-white/10 border border-dashed border-white/30 flex items-center justify-center text-white/50 text-2xl"
                >
                  +
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="bg-black px-6 py-6 safe-bottom">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />

        <div className="flex items-center justify-between gap-4">
          {mode === 'camera' ? (
            <button
              onClick={captureFromVideo}
              disabled={!cameraReady || isProcessing}
              className="w-20 h-20 rounded-full border-4 border-white bg-white/20 active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center mx-auto"
              aria-label="Capture photo"
            >
              <div className="w-14 h-14 rounded-full bg-white" />
            </button>
          ) : (
            <button
              onClick={() => {
                setMode('camera')
                setError(null)
              }}
              className="flex-1 py-3 rounded-xl border border-white/30 text-white font-semibold text-base"
            >
              Open Camera
            </button>
          )}

          {capturedFiles.length > 0 && (
            <button
              onClick={confirmPhotos}
              className="flex-1 py-3 rounded-xl text-white font-semibold text-base active:opacity-90 transition-opacity"
              style={{ backgroundColor: '#006834' }}
            >
              Done ({capturedFiles.length})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
