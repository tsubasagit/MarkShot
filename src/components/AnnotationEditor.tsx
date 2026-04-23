import React, { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Arrow } from 'react-konva'
import type Konva from 'konva'
import Toolbar from './Toolbar'
import type { ToolType, ArrowAnnotation } from '../hooks/useAnnotation'
import { generateId } from '../hooks/useAnnotation'

interface AnnotationEditorProps {
  imageDataUrl: string
  onDone: (editedDataUrl: string) => void
  onCancel: () => void
}

const ARROW_COLOR = '#ff1744'
const ARROW_STROKE = 4

const AnnotationEditor: React.FC<AnnotationEditorProps> = ({
  imageDataUrl,
  onDone,
  onCancel,
}) => {
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<ToolType>('arrow')
  const [annotations, setAnnotations] = useState<ArrowAnnotation[]>([])
  const [draft, setDraft] = useState<ArrowAnnotation | null>(null)
  const stageRef = useRef<Konva.Stage>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => setBgImage(img)
    img.src = imageDataUrl
  }, [imageDataUrl])

  // Fit stage to image natural size, capped to viewport
  const stageSize = (() => {
    if (!bgImage) return { width: 800, height: 600, scale: 1 }
    const maxW = window.innerWidth - 40
    const maxH = window.innerHeight - 120
    const scale = Math.min(1, maxW / bgImage.naturalWidth, maxH / bgImage.naturalHeight)
    return {
      width: bgImage.naturalWidth * scale,
      height: bgImage.naturalHeight * scale,
      scale,
    }
  })()

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'arrow') return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    setDraft({
      type: 'arrow',
      id: generateId(),
      points: [pos.x, pos.y, pos.x, pos.y],
      color: ARROW_COLOR,
      strokeWidth: ARROW_STROKE,
    })
  }

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'arrow' || !draft) return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    setDraft({
      ...draft,
      points: [draft.points[0], draft.points[1], pos.x, pos.y],
    })
  }

  const handleMouseUp = () => {
    if (tool !== 'arrow' || !draft) return
    // only commit if it has non-zero length
    const [x1, y1, x2, y2] = draft.points
    if (Math.hypot(x2 - x1, y2 - y1) > 4) {
      setAnnotations((prev) => [...prev, draft])
    }
    setDraft(null)
  }

  const handleUndo = () => {
    setAnnotations((prev) => prev.slice(0, -1))
  }

  const handleDone = () => {
    const stage = stageRef.current
    if (!stage || !bgImage) return
    // Export at original pixel ratio (1 = stage pixels, our image is scaled down)
    const pixelRatio = bgImage.naturalWidth / stageSize.width
    const dataUrl = stage.toDataURL({ mimeType: 'image/png', pixelRatio })
    onDone(dataUrl)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0f0f1a',
        padding: 8,
        gap: 8,
        boxSizing: 'border-box',
      }}
    >
      <Toolbar
        tool={tool}
        onToolChange={setTool}
        onUndo={handleUndo}
        canUndo={annotations.length > 0}
        onDone={handleDone}
        onCancel={onCancel}
      />
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
        }}
      >
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: tool === 'arrow' ? 'crosshair' : 'default', background: '#000' }}
        >
          <Layer>
            {bgImage && (
              <KonvaImage
                image={bgImage}
                width={stageSize.width}
                height={stageSize.height}
              />
            )}
            {annotations.map((a) => (
              <Arrow
                key={a.id}
                points={a.points}
                stroke={a.color}
                fill={a.color}
                strokeWidth={a.strokeWidth}
                pointerLength={12}
                pointerWidth={12}
              />
            ))}
            {draft && (
              <Arrow
                points={draft.points}
                stroke={draft.color}
                fill={draft.color}
                strokeWidth={draft.strokeWidth}
                pointerLength={12}
                pointerWidth={12}
                opacity={0.7}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}

export default AnnotationEditor
