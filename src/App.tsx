import React, { useState, useEffect } from 'react'
import RegionSelector from './components/RegionSelector'
import AnnotationEditor from './components/AnnotationEditor'
import RecordingOverlay from './components/RecordingOverlay'
import RecordingControl from './components/RecordingControl'

const App: React.FC = () => {
  const [hash] = useState(() => window.location.hash)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)

  const isCapture = hash === '#/capture'
  const isCaptureGif = hash === '#/capture-gif'
  const isRecordingOverlay = hash.startsWith('#/recording-overlay/')
  const isRecordingControl = hash === '#/recording-control'
  const isOverlay = isCapture || isCaptureGif || isRecordingOverlay || isRecordingControl

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

  // Always show editor (with or without image)
  return (
    <AnnotationEditor
      key={capturedImage || 'empty'}
      imageDataUrl={capturedImage}
    />
  )
}

export default App
