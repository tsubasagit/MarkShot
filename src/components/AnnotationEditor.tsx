import React, { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Arrow, Rect, Line, Text } from 'react-konva'
import type Konva from 'konva'
import Toolbar, { PALETTE, STROKE_PRESETS } from './Toolbar'
import {
  useAnnotation,
  generateId,
  type ToolType,
  type Annotation,
  type ArrowAnnotation,
  type RectAnnotation,
  type PenAnnotation,
  type MosaicAnnotation,
  type TextAnnotation,
} from '../hooks/useAnnotation'

interface AnnotationEditorProps {
  imageDataUrl: string
  onDone: (editedDataUrl: string) => void
  onCancel: () => void
}

type Draft =
  | (ArrowAnnotation & { kind: 'arrow' })
  | (RectAnnotation & { kind: 'rect' })
  | (PenAnnotation & { kind: 'pen' })
  | (MosaicAnnotation & { kind: 'mosaic' })
  | null

const MOSAIC_FILL = 'rgba(15, 15, 26, 0.85)'

const AnnotationEditor: React.FC<AnnotationEditorProps> = ({
  imageDataUrl,
  onDone,
  onCancel,
}) => {
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<ToolType>('arrow')
  const [color, setColor] = useState<string>(PALETTE[0])
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_PRESETS[1].value)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(null)
  const stageRef = useRef<Konva.Stage>(null)

  const {
    annotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useAnnotation()

  useEffect(() => {
    const img = new Image()
    img.onload = () => setBgImage(img)
    img.src = imageDataUrl
  }, [imageDataUrl])

  // Keyboard: Delete / Backspace to remove selected
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const target = e.target as HTMLElement | null
        // 入力要素上では無効
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
        removeAnnotation(selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, removeAnnotation])

  // Fit stage to image natural size, capped to viewport
  const stageSize = (() => {
    if (!bgImage) return { width: 800, height: 600 }
    const maxW = window.innerWidth - 40
    const maxH = window.innerHeight - 120
    const scale = Math.min(1, maxW / bgImage.naturalWidth, maxH / bgImage.naturalHeight)
    return {
      width: bgImage.naturalWidth * scale,
      height: bgImage.naturalHeight * scale,
    }
  })()

  const pointerPos = (e: Konva.KonvaEventObject<MouseEvent>) =>
    e.target.getStage()?.getPointerPosition() ?? null

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Stage以外（既存ノード）を押したときは選択挙動に任せる
    if (tool === 'select') return

    if (tool === 'text') {
      const pos = pointerPos(e)
      if (!pos) return
      const text = window.prompt('テキストを入力', '')
      if (!text) return
      const ann: TextAnnotation = {
        type: 'text',
        id: generateId(),
        x: pos.x,
        y: pos.y,
        text,
        fontSize: Math.max(14, strokeWidth * 6),
        color,
      }
      addAnnotation(ann)
      return
    }

    const pos = pointerPos(e)
    if (!pos) return
    const id = generateId()
    if (tool === 'arrow') {
      setDraft({
        kind: 'arrow',
        type: 'arrow',
        id,
        points: [pos.x, pos.y, pos.x, pos.y],
        color,
        strokeWidth,
      })
    } else if (tool === 'rect') {
      setDraft({
        kind: 'rect',
        type: 'rect',
        id,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        color,
        strokeWidth,
      })
    } else if (tool === 'pen') {
      setDraft({
        kind: 'pen',
        type: 'pen',
        id,
        points: [pos.x, pos.y],
        color,
        strokeWidth,
      })
    } else if (tool === 'mosaic') {
      setDraft({
        kind: 'mosaic',
        type: 'mosaic',
        id,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        pixelSize: 10,
      })
    }
  }

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!draft) return
    const pos = pointerPos(e)
    if (!pos) return
    if (draft.kind === 'arrow') {
      setDraft({ ...draft, points: [draft.points[0], draft.points[1], pos.x, pos.y] })
    } else if (draft.kind === 'rect' || draft.kind === 'mosaic') {
      setDraft({
        ...draft,
        width: pos.x - draft.x,
        height: pos.y - draft.y,
      })
    } else if (draft.kind === 'pen') {
      setDraft({ ...draft, points: [...draft.points, pos.x, pos.y] })
    }
  }

  const handleMouseUp = () => {
    if (!draft) return
    if (draft.kind === 'arrow') {
      const [x1, y1, x2, y2] = draft.points
      if (Math.hypot(x2 - x1, y2 - y1) > 4) {
        const { kind: _k, ...ann } = draft
        void _k
        addAnnotation(ann)
      }
    } else if (draft.kind === 'rect' || draft.kind === 'mosaic') {
      if (Math.abs(draft.width) > 4 && Math.abs(draft.height) > 4) {
        const normalized = normalizeRect(draft)
        const { kind: _k, ...ann } = normalized
        void _k
        addAnnotation(ann)
      }
    } else if (draft.kind === 'pen') {
      if (draft.points.length >= 4) {
        const { kind: _k, ...ann } = draft
        void _k
        addAnnotation(ann)
      }
    }
    setDraft(null)
  }

  const applyDragEndOffset = (id: string, dx: number, dy: number) => {
    const ann = annotations.find((a) => a.id === id)
    if (!ann) return
    if (ann.type === 'arrow') {
      const [x1, y1, x2, y2] = ann.points
      updateAnnotation(id, { points: [x1 + dx, y1 + dy, x2 + dx, y2 + dy] })
    } else if (ann.type === 'pen') {
      const pts = ann.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy))
      updateAnnotation(id, { points: pts })
    } else if (
      ann.type === 'rect' ||
      ann.type === 'mosaic' ||
      ann.type === 'text' ||
      ann.type === 'ellipse' ||
      ann.type === 'step' ||
      ann.type === 'badge'
    ) {
      updateAnnotation(id, { x: (ann as { x: number }).x + dx, y: (ann as { y: number }).y + dy })
    }
  }

  const handleDone = () => {
    const stage = stageRef.current
    if (!stage || !bgImage) return
    // 選択ハイライトを消してから出力
    setSelectedId(null)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const pixelRatio = bgImage.naturalWidth / stageSize.width
        const dataUrl = stage.toDataURL({ mimeType: 'image/png', pixelRatio })
        onDone(dataUrl)
      })
    })
  }

  const isSelectTool = tool === 'select'

  const renderAnnotation = (a: Annotation) => {
    const selected = selectedId === a.id
    const shadow = selected
      ? { shadowColor: '#00FFFF', shadowBlur: 10, shadowOpacity: 1 }
      : {}
    const common = {
      draggable: isSelectTool,
      onClick: () => isSelectTool && setSelectedId(a.id),
      onTap: () => isSelectTool && setSelectedId(a.id),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target
        const dx = node.x()
        const dy = node.y()
        node.position({ x: 0, y: 0 })
        applyDragEndOffset(a.id, dx, dy)
      },
      ...shadow,
    }

    if (a.type === 'arrow') {
      return (
        <Arrow
          key={a.id}
          points={a.points}
          stroke={a.color}
          fill={a.color}
          strokeWidth={a.strokeWidth}
          pointerLength={12}
          pointerWidth={12}
          hitStrokeWidth={Math.max(a.strokeWidth, 12)}
          {...common}
        />
      )
    }
    if (a.type === 'rect') {
      return (
        <Rect
          key={a.id}
          x={a.x}
          y={a.y}
          width={a.width}
          height={a.height}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          fillEnabled={false}
          {...common}
        />
      )
    }
    if (a.type === 'pen') {
      return (
        <Line
          key={a.id}
          points={a.points}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          hitStrokeWidth={Math.max(a.strokeWidth, 12)}
          {...common}
        />
      )
    }
    if (a.type === 'mosaic') {
      return (
        <Rect
          key={a.id}
          x={a.x}
          y={a.y}
          width={a.width}
          height={a.height}
          fill={MOSAIC_FILL}
          {...common}
        />
      )
    }
    if (a.type === 'text') {
      return (
        <Text
          key={a.id}
          x={a.x}
          y={a.y}
          text={a.text}
          fontSize={a.fontSize}
          fill={a.color}
          fontStyle="bold"
          {...common}
        />
      )
    }
    return null
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
        onToolChange={(t) => {
          setTool(t)
          setSelectedId(null)
        }}
        color={color}
        onColorChange={setColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
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
          onMouseDown={(e) => {
            // 空の Stage 背景をクリックしたら選択解除
            if (isSelectTool && e.target === e.target.getStage()) {
              setSelectedId(null)
            }
            handleMouseDown(e)
          }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{
            cursor: isSelectTool ? 'default' : 'crosshair',
            background: '#000',
          }}
        >
          <Layer>
            {bgImage && (
              <KonvaImage
                image={bgImage}
                width={stageSize.width}
                height={stageSize.height}
                listening={false}
              />
            )}
            {annotations.map(renderAnnotation)}
            {draft && renderDraft(draft)}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}

function renderDraft(d: Exclude<Draft, null>) {
  if (d.kind === 'arrow') {
    return (
      <Arrow
        points={d.points}
        stroke={d.color}
        fill={d.color}
        strokeWidth={d.strokeWidth}
        pointerLength={12}
        pointerWidth={12}
        opacity={0.7}
      />
    )
  }
  if (d.kind === 'rect') {
    return (
      <Rect
        x={d.x}
        y={d.y}
        width={d.width}
        height={d.height}
        stroke={d.color}
        strokeWidth={d.strokeWidth}
        fillEnabled={false}
        opacity={0.7}
        dash={[6, 6]}
      />
    )
  }
  if (d.kind === 'pen') {
    return (
      <Line
        points={d.points}
        stroke={d.color}
        strokeWidth={d.strokeWidth}
        lineCap="round"
        lineJoin="round"
        tension={0.4}
        opacity={0.7}
      />
    )
  }
  if (d.kind === 'mosaic') {
    return (
      <Rect
        x={d.x}
        y={d.y}
        width={d.width}
        height={d.height}
        fill={MOSAIC_FILL}
        opacity={0.6}
        dash={[6, 6]}
      />
    )
  }
  return null
}

// ドラッグで負の幅になった矩形を正の幅に正規化（mosaic/rect 共通）
function normalizeRect<T extends { x: number; y: number; width: number; height: number }>(r: T): T {
  const x = r.width < 0 ? r.x + r.width : r.x
  const y = r.height < 0 ? r.y + r.height : r.y
  return { ...r, x, y, width: Math.abs(r.width), height: Math.abs(r.height) }
}

export default AnnotationEditor
