import React, { useState, useEffect } from 'react'
import RegionSelector from './components/RegionSelector'
import AnnotationEditor from './components/AnnotationEditor'

const App: React.FC = () => {
  const [isCapture] = useState(() => window.location.hash === '#/capture')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)

  useEffect(() => {
    if (isCapture) {
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

  // Always show editor (with or without image)
  return (
    <AnnotationEditor
      key={capturedImage || 'empty'}
      imageDataUrl={capturedImage}
    />
  )
}

export default App
