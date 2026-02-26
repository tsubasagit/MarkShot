import React, { useState, useEffect, Suspense, lazy } from 'react'
import RegionSelector from './components/RegionSelector'
import RecordingOverlay from './components/RecordingOverlay'
import RecordingControl from './components/RecordingControl'
import CountdownOverlay from './components/CountdownOverlay'

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
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      color: '#888',
      fontSize: 14,
    }}>
      スクリーンショットはトレイアイコンから撮影できます
    </div>
  )
}

export default App
