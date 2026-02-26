import React, { useState, useEffect, Suspense, lazy } from 'react'
import RegionSelector from './components/RegionSelector'
import RecordingOverlay from './components/RecordingOverlay'
import RecordingControl from './components/RecordingControl'
import CountdownOverlay from './components/CountdownOverlay'
import CaptureBar from './components/CaptureBar'

// Konva を含むエディタは初回起動時に読まない（起動時間短縮）
const AnnotationEditor = lazy(() => import('./components/AnnotationEditor'))

const App: React.FC = () => {
  const [hash] = useState(() => window.location.hash)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)

  const isCapture = hash.startsWith('#/capture?') || hash === '#/capture'
  const isCaptureGif = hash.startsWith('#/capture-gif?') || hash === '#/capture-gif'
  const isRecordingOverlay = hash.startsWith('#/recording-overlay/')
  const isRecordingControl = hash === '#/recording-control'
  const isCountdown = hash === '#/countdown'
  const isOverlay = isCapture || isCaptureGif || isRecordingOverlay || isRecordingControl || isCountdown

  useEffect(() => {
    if (isOverlay) {
      document.body.className = 'capture-mode'
      return
    }

    document.body.className = 'editor-mode'

    const cleanupEditorOpen = window.electronAPI?.onEditorOpen((imageDataUrl: string) => {
      setCapturedImage(imageDataUrl)
    })

    window.electronAPI?.requestEditorImage()

    return () => {
      cleanupEditorOpen?.()
    }
  }, [])

  if (isCapture) {
    return <RegionSelector />
  }

  if (isCaptureGif) {
    return <RegionSelector mode="gif" />
  }

  if (isRecordingOverlay) {
    const parts = hash.replace('#/recording-overlay/', '').split('/')
    const region = {
      x: Number(parts[0]),
      y: Number(parts[1]),
      w: Number(parts[2]),
      h: Number(parts[3]),
      scaleFactor: Number(parts[4]),
    }
    return <RecordingOverlay region={region} />
  }

  if (isRecordingControl) {
    return <RecordingControl />
  }

  if (isCountdown) {
    return <CountdownOverlay />
  }

  // 画像があるときだけ Konva エディタを読み込む（起動直後は軽いプレースホルダー）
  if (capturedImage) {
    return (
      <Suspense fallback={<Placeholder />}>
        <AnnotationEditor
          key={capturedImage || 'empty'}
          imageDataUrl={capturedImage}
        />
      </Suspense>
    )
  }
  return <Placeholder />
}

function Placeholder() {
  const [captureMode, setCaptureMode] = useState<'screenshot' | 'gif'>('screenshot')
  const handleNewCapture = () => {
    if (captureMode === 'gif') {
      window.electronAPI?.startGifCapture?.()
    } else {
      window.electronAPI?.startCapture?.()
    }
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0f0f1a',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          width: '100%',
          justifyContent: 'center',
        }}
      >
        <CaptureBar
          captureMode={captureMode}
          onCaptureModeChange={setCaptureMode}
          onNewCapture={handleNewCapture}
          disabled={false}
        />
      </div>
      <div className="empty-state" style={{ flex: 1 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4a4a6a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <h2>MarkShot</h2>
        <p>
          <strong>New</strong> ボタンでキャプチャ開始<br />
          GIFモードに切り替えてGIF録画
        </p>
      </div>
    </div>
  )
}

export default App
