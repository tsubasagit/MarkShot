import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Line,
  Arrow,
  Rect,
  Ellipse,
  Text,
  Circle,
  Group,
  Transformer,
} from 'react-konva'
import Konva from 'konva'
import Toolbar from './Toolbar'
import SharePanel from './SharePanel'
import {
  useAnnotation,
  ToolType,
  Annotation,
  BadgeKind,
  generateId,
} from '../hooks/useAnnotation'

interface AnnotationEditorProps {
  imageDataUrl: string | null
}

const BADGE_COLORS: Record<BadgeKind, { bg: string; fg: string }> = {
  OK: { bg: '#00e676', fg: '#000' },
  NG: { bg: '#ff1744', fg: '#fff' },
  WARN: { bg: '#ffea00', fg: '#000' },
  INFO: { bg: '#00b0ff', fg: '#fff' },
  BUG: { bg: '#ff9100', fg: '#fff' },
}

// Tool shortcut key map
const TOOL_SHORTCUTS: Record<string, ToolType> = {
  v: 'select', p: 'pen', t: 'text', a: 'arrow',
  r: 'rect', e: 'ellipse', m: 'mosaic', s: 'step', b: 'badge',
}

const AnnotationEditor: React.FC<AnnotationEditorProps> = ({
  imageDataUrl,
}) => {
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })

  const [activeTool, setActiveTool] = useState<ToolType>('select')
  const [color, setColor] = useState('#FF0055')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [fontSize, setFontSize] = useState(24)
  const [badgeKind, setBadgeKind] = useState<BadgeKind>('OK')
  const [mosaicSize, setMosaicSize] = useState(10)

  const [isDrawing, setIsDrawing] = useState(false)
  const [currentPenPoints, setCurrentPenPoints] = useState<number[]>([])
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ text: string; error: boolean } | null>(null)

  // Zoom/Pan state
  const [stageScale, setStageScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })

  // GIF recording state
  const [isGifRecording, setIsGifRecording] = useState(false)
  const [gifElapsed, setGifElapsed] = useState(0)
  const [gifFrameCount, setGifFrameCount] = useState(0)
  const [gifPreparing, setGifPreparing] = useState(false)
  const [gifEncoding, setGifEncoding] = useState(false)
  const [gifPreviewUrl, setGifPreviewUrl] = useState<string | null>(null)
  const [gifCountdown, setGifCountdown] = useState<number | null>(null)
  const gifRef = useRef<{ stream: MediaStream; stop: () => void } | null>(null)
  const gifTimerRef = useRef<number | null>(null)

  // Pen throttle ref
  const penThrottleRef = useRef<number>(0)

  const {
    annotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    undo,
    redo,
    canUndo,
    canRedo,
    stepCounter,
  } = useAnnotation()

  const showStatus = (text: string, error = false) => {
    setStatusMsg({ text, error })
    setTimeout(() => setStatusMsg(null), 4000)
  }

  // Export stage as data URL
  const exportImage = useCallback((): string | null => {
    if (gifPreviewUrl) return gifPreviewUrl

    const stage = stageRef.current
    if (!stage || !image) return null

    const scaleX = image.width / stageSize.width
    const scaleY = image.height / stageSize.height
    return stage.toDataURL({
      pixelRatio: Math.max(scaleX, scaleY) / stageScale,
      mimeType: 'image/png',
    })
  }, [image, stageSize, stageScale, gifPreviewUrl])

  // Load captured image
  useEffect(() => {
    if (!imageDataUrl) return
    const img = new window.Image()
    img.onload = () => {
      setImage(img)
      const maxW = window.innerWidth - 40
      const maxH = window.innerHeight - 160
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)
      setStageSize({
        width: Math.round(img.width * scale),
        height: Math.round(img.height * scale),
      })
      // Reset zoom/pan when new image loads
      setStageScale(1)
      setStagePos({ x: 0, y: 0 })
      showStatus('クリップボードにコピー済み')
    }
    img.src = imageDataUrl
  }, [imageDataUrl])

  // Auto-save on window close request
  useEffect(() => {
    const cleanup = window.electronAPI?.onAutoSaveRequest(async () => {
      if (image) {
        const dataUrl = exportImage()
        if (dataUrl) {
          await window.electronAPI.autoSave(dataUrl)
        }
      }
      window.electronAPI.autoSaveComplete()
    })
    return cleanup
  }, [exportImage, image])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts when editing text
      if (editingTextId) return

      // Ignore shortcuts when focus is in an input or textarea (e.g. settings panel)
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        removeAnnotation(selectedId)
        setSelectedId(null)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
        setActiveTool('select')
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        // Tool shortcuts (single key)
        const tool = TOOL_SHORTCUTS[e.key.toLowerCase()]
        if (tool) {
          setActiveTool(tool)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, selectedId, removeAnnotation, editingTextId])

  // Update Transformer when selection changes
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return

    if (!selectedId || activeTool !== 'select') {
      tr.nodes([])
      tr.getLayer()?.batchDraw()
      return
    }

    const stage = stageRef.current
    if (!stage) return

    const node = stage.findOne(`#${selectedId}`)
    if (node) {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    } else {
      tr.nodes([])
      tr.getLayer()?.batchDraw()
    }
  }, [selectedId, activeTool, annotations])

  // Cleanup recording timers on unmount
  useEffect(() => {
    return () => {
      if (gifTimerRef.current) clearInterval(gifTimerRef.current)
    }
  }, [])

  // New screenshot with auto-save
  const handleNewCapture = async () => {
    try {
      if (image) {
        const dataUrl = exportImage()
        if (dataUrl) {
          await window.electronAPI?.autoSave(dataUrl)
        }
      }
      setGifPreviewUrl(null)
      window.electronAPI?.startCapture()
    } catch (err) {
      console.error('[handleNewCapture] error:', err)
    }
  }

  // GIF recording — start region selection via overlay
  const handleRecordGif = async () => {
    console.log('[handleRecordGif] called')
    try {
      if (image) {
        const dataUrl = exportImage()
        if (dataUrl) await window.electronAPI?.autoSave(dataUrl)
      }

      setGifPreviewUrl(null)
      console.log('[handleRecordGif] calling startGifCapture')
      window.electronAPI?.startGifCapture()
    } catch (err) {
      console.error('[handleRecordGif] error:', err)
    }
  }

  // Start recording with selected region
  const startGifWithRegion = useCallback(async (region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => {
    console.log('[startGifWithRegion] called, region:', region)
    setGifPreparing(true)
    showStatus('GIF録画を準備中...')

    try {
      console.log('[startGifWithRegion] calling getDisplayMedia...')
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never',
        } as any,
        audio: false,
      })

      setGifPreparing(false)

      // 3秒カウントダウン（画面上にオーバーレイ表示）
      for (let i = 3; i > 0; i--) {
        setGifCountdown(i)
        await new Promise((r) => setTimeout(r, 1000))
      }
      setGifCountdown(null)

      window.electronAPI?.hideWindow()
      await new Promise((r) => setTimeout(r, 300))

      const videoTrack = stream.getVideoTracks()[0]
      const trackSettings = videoTrack.getSettings()
      const srcW = trackSettings.width || 800
      const srcH = trackSettings.height || 600

      // Output size = selected region, scaled down if needed (max 800px wide)
      const MAX_W = 800
      const outScale = region.w > MAX_W ? MAX_W / region.w : 1
      const w = Math.round(region.w * outScale)
      const h = Math.round(region.h * outScale)

      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      await video.play()

      // Full-screen capture canvas
      const fullCanvas = document.createElement('canvas')
      fullCanvas.width = srcW
      fullCanvas.height = srcH
      const fullCtx = fullCanvas.getContext('2d')!

      // Cropped output canvas
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!

      const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
      const gif = GIFEncoder()

      const FPS = 10
      const MAX_SECONDS = 30
      const frameDelay = 1000 / FPS
      let frameCount = 0
      let globalPalette: number[][] | null = null
      let captureIntervalId: number | null = null

      let stopped = false

      const captureFrame = () => {
        if (stopped) return

        if (frameCount >= MAX_SECONDS * FPS) {
          stopGif()
          return
        }

        // Draw full screen to full canvas
        fullCtx.drawImage(video, 0, 0, srcW, srcH)
        // Crop selected region to output canvas
        ctx.drawImage(
          fullCanvas,
          region.x, region.y, region.w, region.h,
          0, 0, w, h
        )
        const imageData = ctx.getImageData(0, 0, w, h)

        if (!globalPalette) {
          // First frame: build global palette
          globalPalette = quantize(imageData.data as unknown as Uint8ClampedArray, 256)
        }
        const index = applyPalette(imageData.data as unknown as Uint8ClampedArray, globalPalette)
        gif.writeFrame(index, w, h, { palette: globalPalette, delay: frameDelay })
        frameCount++
        setGifFrameCount(frameCount)
      }

      // Use setInterval instead of requestAnimationFrame
      // so frames are captured even when the window is hidden
      captureIntervalId = window.setInterval(captureFrame, frameDelay)

      const stopGif = async () => {
        if (stopped) return
        stopped = true
        if (captureIntervalId !== null) clearInterval(captureIntervalId)
        cleanupStopListener?.()

        if (gifTimerRef.current) {
          clearInterval(gifTimerRef.current)
          gifTimerRef.current = null
        }
        setIsGifRecording(false)
        setGifElapsed(0)
        setGifFrameCount(0)
        gifRef.current = null

        video.pause()
        video.srcObject = null
        stream.getTracks().forEach((t) => t.stop())

        window.electronAPI?.hideRecordingUI()
        window.electronAPI?.showWindow()
        setGifEncoding(true)
        showStatus('GIFをエンコード中...')

        try {
          gif.finish()
          const bytes = gif.bytes()

          const gifBlob = new Blob([new Uint8Array(bytes)], { type: 'image/gif' })
          const gifDataUrl = await new Promise<string>((resolve) => {
            const r = new FileReader()
            r.onload = () => resolve(r.result as string)
            r.readAsDataURL(gifBlob)
          })

          setGifPreviewUrl(gifDataUrl)
          setGifEncoding(false)

          // 1. Save locally
          const result = await window.electronAPI.saveGif(bytes)
          if (!result) {
            showStatus('GIF save failed locally', true)
          } else {
            showStatus(`GIF saved: ${result}`)
          }

          // 2. Upload to Drive (optional)
          try {
            const connected = await window.electronAPI.googleStatus()
            if (connected && result) {
              const driveResult = await window.electronAPI.uploadToGoogleDrive(gifDataUrl)
              if (driveResult?.fileUrl) {
                const { copyTextToClipboard } = await import('../utils/clipboard')
                copyTextToClipboard(driveResult.fileUrl)
                showStatus(`GIF saved & uploaded — URL copied`)
              }
            }
          } catch (e) {
            console.error('Drive upload failed', e)
            // Keep the previous "GIF saved: ..." status visible if upload fails silently
          }
        } catch (err: any) {
          setGifEncoding(false)
          showStatus(`GIF save error: ${err.message}`, true)
        }
      }

      videoTrack.addEventListener('ended', () => {
        stopGif()
      })

      const cleanupStopListener = window.electronAPI?.onGifStopRecording(() => {
        stopGif()
      })

      gifRef.current = { stream, stop: stopGif }
      setIsGifRecording(true)
      setGifElapsed(0)
      setGifFrameCount(0)
      gifTimerRef.current = window.setInterval(() => {
        setGifElapsed((prev) => prev + 1)
      }, 1000)

      window.electronAPI?.showRecordingUI(region)
    } catch (err: any) {
      setGifPreparing(false)
      setGifCountdown(null)
      window.electronAPI?.showWindow()
      if (err.name !== 'NotAllowedError') {
        showStatus(`GIF録画エラー: ${err.message}`, true)
      }
    }
  }, [exportImage, image])

  // Listen for GIF region selection from overlay
  useEffect(() => {
    const cleanup = window.electronAPI?.onGifRegionReady((region) => {
      startGifWithRegion(region)
    })
    return cleanup
  }, [startGifWithRegion])

  const handleStopGif = () => {
    gifRef.current?.stop()
  }

  // Zoom with Ctrl+Wheel
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!e.evt.ctrlKey) return
    e.evt.preventDefault()

    const stage = stageRef.current
    if (!stage) return

    const oldScale = stageScale
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const scaleBy = 1.1
    const newScale = e.evt.deltaY < 0
      ? Math.min(oldScale * scaleBy, 5)
      : Math.max(oldScale / scaleBy, 0.2)

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    }

    setStageScale(newScale)
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }, [stageScale, stagePos])

  const getPointerPosition = (): { x: number; y: number } | null => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    // Adjust for scale and position
    return {
      x: (pos.x - stagePos.x) / stageScale,
      y: (pos.y - stagePos.y) / stageScale,
    }
  }

  const handleStageMouseDown = () => {
    const pos = getPointerPosition()
    if (!pos) return

    if (activeTool === 'select') {
      const clickedOnEmpty = stageRef.current?.getIntersection(
        stageRef.current.getPointerPosition()!
      )
      if (!clickedOnEmpty || (clickedOnEmpty as unknown) === stageRef.current) {
        setSelectedId(null)
      }
      return
    }

    if (activeTool === 'text') {
      const id = generateId()
      addAnnotation({
        type: 'text',
        id,
        x: pos.x,
        y: pos.y,
        text: 'テキスト',
        fontSize,
        color,
      })
      setEditingTextId(id)
      // Keep text tool active for consecutive placements (don't reset to select)
      return
    }

    if (activeTool === 'step') {
      addAnnotation({
        type: 'step',
        id: generateId(),
        x: pos.x,
        y: pos.y,
        number: stepCounter,
        color,
      })
      return
    }

    if (activeTool === 'badge') {
      addAnnotation({
        type: 'badge',
        id: generateId(),
        x: pos.x,
        y: pos.y,
        kind: badgeKind,
      })
      return
    }

    setIsDrawing(true)
    setDrawStart(pos)

    if (activeTool === 'pen') {
      setCurrentPenPoints([pos.x, pos.y])
    }
  }

  const handleStageMouseMove = () => {
    if (!isDrawing) return
    const pos = getPointerPosition()
    if (!pos) return

    if (activeTool === 'pen') {
      // Throttle pen updates (A4: ~16ms = 60fps max)
      const now = performance.now()
      if (now - penThrottleRef.current < 16) return
      penThrottleRef.current = now
      setCurrentPenPoints((prev) => [...prev, pos.x, pos.y])
    }
  }

  const handleStageMouseUp = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    const pos = getPointerPosition()
    if (!pos || !drawStart) return

    const id = generateId()

    switch (activeTool) {
      case 'pen':
        if (currentPenPoints.length > 2) {
          addAnnotation({
            type: 'pen',
            id,
            points: currentPenPoints,
            color,
            strokeWidth,
          })
        }
        setCurrentPenPoints([])
        break

      case 'arrow': {
        const dx = pos.x - drawStart.x
        const dy = pos.y - drawStart.y
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          addAnnotation({
            type: 'arrow',
            id,
            points: [drawStart.x, drawStart.y, pos.x, pos.y],
            color,
            strokeWidth,
          })
        }
        break
      }

      case 'rect': {
        const w = pos.x - drawStart.x
        const h = pos.y - drawStart.y
        if (Math.abs(w) > 5 && Math.abs(h) > 5) {
          addAnnotation({
            type: 'rect',
            id,
            x: Math.min(drawStart.x, pos.x),
            y: Math.min(drawStart.y, pos.y),
            width: Math.abs(w),
            height: Math.abs(h),
            color,
            strokeWidth,
          })
        }
        break
      }

      case 'ellipse': {
        const rx = Math.abs(pos.x - drawStart.x) / 2
        const ry = Math.abs(pos.y - drawStart.y) / 2
        if (rx > 3 && ry > 3) {
          addAnnotation({
            type: 'ellipse',
            id,
            x: (drawStart.x + pos.x) / 2,
            y: (drawStart.y + pos.y) / 2,
            radiusX: rx,
            radiusY: ry,
            color,
            strokeWidth,
          })
        }
        break
      }

      case 'mosaic': {
        const mw = pos.x - drawStart.x
        const mh = pos.y - drawStart.y
        if (Math.abs(mw) > 5 && Math.abs(mh) > 5) {
          addAnnotation({
            type: 'mosaic',
            id,
            x: Math.min(drawStart.x, pos.x),
            y: Math.min(drawStart.y, pos.y),
            width: Math.abs(mw),
            height: Math.abs(mh),
            pixelSize: mosaicSize,
          })
        }
        break
      }
    }

    setDrawStart(null)
    // B1: Do NOT reset to select tool — keep current tool active
  }

  // 右クリックで即座に選択ツールに戻す
  const handleContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    setActiveTool('select')
    setSelectedId(null)
    setIsDrawing(false)
    setCurrentPenPoints([])
    setDrawStart(null)
  }

  // Handle transform end — update annotation dimensions
  const handleTransformEnd = (ann: Annotation) => {
    const stage = stageRef.current
    if (!stage) return
    const node = stage.findOne(`#${ann.id}`)
    if (!node) return

    const scaleX = node.scaleX()
    const scaleY = node.scaleY()

    // Reset node scale and apply to dimensions
    node.scaleX(1)
    node.scaleY(1)

    switch (ann.type) {
      case 'rect':
      case 'mosaic':
        updateAnnotation(ann.id, {
          x: node.x(),
          y: node.y(),
          width: Math.max(5, ann.width * scaleX),
          height: Math.max(5, ann.height * scaleY),
        })
        break
      case 'ellipse':
        updateAnnotation(ann.id, {
          x: node.x(),
          y: node.y(),
          radiusX: Math.max(3, ann.radiusX * scaleX),
          radiusY: Math.max(3, ann.radiusY * scaleY),
        })
        break
      case 'text':
        updateAnnotation(ann.id, {
          x: node.x(),
          y: node.y(),
          fontSize: Math.max(8, Math.round(ann.fontSize * scaleY)),
        })
        break
    }
  }

  // Text editing via textarea overlay
  const handleTextDblClick = (ann: Annotation & { type: 'text' }) => {
    setEditingTextId(ann.id)
    const stage = stageRef.current
    if (!stage) return

    const stageContainer = stage.container()
    const stageRect = stageContainer.getBoundingClientRect()

    const textarea = document.createElement('textarea')
    textarea.value = ann.text
    textarea.style.position = 'fixed'
    textarea.style.left = `${stageRect.left + (ann.x * stageScale + stagePos.x)}px`
    textarea.style.top = `${stageRect.top + (ann.y * stageScale + stagePos.y)}px`
    textarea.style.fontSize = `${ann.fontSize * stageScale}px`
    textarea.style.color = ann.color
    textarea.style.border = '2px solid #00FFFF'
    textarea.style.borderRadius = '4px'
    textarea.style.padding = '4px'
    textarea.style.background = 'rgba(15, 15, 26, 0.95)'
    textarea.style.outline = 'none'
    textarea.style.resize = 'both'
    textarea.style.minWidth = '100px'
    textarea.style.minHeight = `${ann.fontSize + 8}px`
    textarea.style.fontFamily = 'Segoe UI, Meiryo, sans-serif'
    textarea.style.zIndex = '10000'
    textarea.style.overflow = 'hidden'

    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()

    const finishEditing = () => {
      const newText = textarea.value
      if (newText.trim()) {
        updateAnnotation(ann.id, { text: newText })
      }
      if (document.body.contains(textarea)) {
        document.body.removeChild(textarea)
      }
      setEditingTextId(null)
    }

    textarea.addEventListener('blur', finishEditing)
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        finishEditing()
      }
      if (e.key === 'Escape') {
        if (document.body.contains(textarea)) {
          document.body.removeChild(textarea)
        }
        setEditingTextId(null)
      }
    })
  }

  // Mosaic rendering using real pixelation of source image
  const MosaicImage: React.FC<{ ann: Annotation & { type: 'mosaic' } }> = React.memo(({ ann }) => {
    const [mosaicImage, setMosaicImage] = useState<HTMLCanvasElement | null>(null)

    useEffect(() => {
      if (!image) return

      const w = Math.round(ann.width)
      const h = Math.round(ann.height)
      const ps = ann.pixelSize

      // Calculate source region in original image coordinates
      const scaleX = image.width / stageSize.width
      const scaleY = image.height / stageSize.height
      const srcX = Math.round(ann.x * scaleX)
      const srcY = Math.round(ann.y * scaleY)
      const srcW = Math.round(w * scaleX)
      const srcH = Math.round(h * scaleY)

      // Step 1: Downscale — draw source region into a tiny canvas
      const smallW = Math.max(1, Math.ceil(w / ps))
      const smallH = Math.max(1, Math.ceil(h / ps))
      const smallCanvas = document.createElement('canvas')
      smallCanvas.width = smallW
      smallCanvas.height = smallH
      const smallCtx = smallCanvas.getContext('2d')
      if (!smallCtx) return
      smallCtx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, smallW, smallH)

      // Step 2: Upscale with nearest-neighbor (no smoothing) for pixelated look
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(smallCanvas, 0, 0, w, h)

      setMosaicImage(canvas)
    }, [ann.width, ann.height, ann.pixelSize, ann.x, ann.y, image, stageSize])

    if (!mosaicImage) return null

    return (
      <KonvaImage
        id={ann.id}
        image={mosaicImage}
        x={ann.x}
        y={ann.y}
        width={ann.width}
        height={ann.height}
        draggable={activeTool === 'select'}
        onClick={() => {
          if (activeTool === 'select') setSelectedId(ann.id)
        }}
        onDragEnd={(e) => {
          updateAnnotation(ann.id, { x: e.target.x(), y: e.target.y() })
        }}
        onTransformEnd={() => handleTransformEnd(ann)}
      />
    )
  })

  // Draw preview while dragging
  const renderDrawPreview = () => {
    if (!isDrawing || !drawStart) return null
    const pos = getPointerPosition()
    if (!pos) return null

    switch (activeTool) {
      case 'pen':
        return (
          <Line
            points={currentPenPoints}
            stroke={color}
            strokeWidth={strokeWidth}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
          />
        )
      case 'arrow':
        return (
          <Arrow
            points={[drawStart.x, drawStart.y, pos.x, pos.y]}
            stroke={color}
            strokeWidth={strokeWidth}
            fill={color}
            pointerLength={10}
            pointerWidth={8}
          />
        )
      case 'rect':
        return (
          <Rect
            x={Math.min(drawStart.x, pos.x)}
            y={Math.min(drawStart.y, pos.y)}
            width={Math.abs(pos.x - drawStart.x)}
            height={Math.abs(pos.y - drawStart.y)}
            stroke={color}
            strokeWidth={strokeWidth}
            dash={[5, 5]}
          />
        )
      case 'ellipse':
        return (
          <Ellipse
            x={(drawStart.x + pos.x) / 2}
            y={(drawStart.y + pos.y) / 2}
            radiusX={Math.abs(pos.x - drawStart.x) / 2}
            radiusY={Math.abs(pos.y - drawStart.y) / 2}
            stroke={color}
            strokeWidth={strokeWidth}
            dash={[5, 5]}
          />
        )
      case 'mosaic':
        return (
          <Rect
            x={Math.min(drawStart.x, pos.x)}
            y={Math.min(drawStart.y, pos.y)}
            width={Math.abs(pos.x - drawStart.x)}
            height={Math.abs(pos.y - drawStart.y)}
            stroke="#6c7086"
            strokeWidth={1}
            dash={[3, 3]}
            fill="rgba(108, 112, 134, 0.3)"
          />
        )
      default:
        return null
    }
  }

  const renderAnnotation = (ann: Annotation) => {
    const isDraggable = activeTool === 'select'

    switch (ann.type) {
      case 'pen':
        return (
          <Line
            key={ann.id}
            id={ann.id}
            points={ann.points}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            onClick={() => {
              if (activeTool === 'select') setSelectedId(ann.id)
            }}
          />
        )

      case 'text':
        return (
          <React.Fragment key={ann.id}>
            <Text
              x={ann.x + 1}
              y={ann.y + 1}
              text={ann.text}
              fontSize={ann.fontSize}
              fill="rgba(0,0,0,0.6)"
              fontFamily="Segoe UI, Meiryo, sans-serif"
              fontStyle="bold"
              listening={false}
              visible={editingTextId !== ann.id}
            />
            <Text
              id={ann.id}
              x={ann.x}
              y={ann.y}
              text={ann.text}
              fontSize={ann.fontSize}
              fill={ann.color}
              fontFamily="Segoe UI, Meiryo, sans-serif"
              fontStyle="bold"
              draggable={isDraggable}
              visible={editingTextId !== ann.id}
              onClick={() => {
                if (activeTool === 'select') setSelectedId(ann.id)
              }}
              onDblClick={() => handleTextDblClick(ann)}
              onDragEnd={(e) => {
                updateAnnotation(ann.id, {
                  x: e.target.x(),
                  y: e.target.y(),
                })
              }}
              onTransformEnd={() => handleTransformEnd(ann)}
            />
          </React.Fragment>
        )

      case 'arrow':
        return (
          <Arrow
            key={ann.id}
            id={ann.id}
            points={ann.points}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            fill={ann.color}
            pointerLength={10}
            pointerWidth={8}
            draggable={isDraggable}
            onClick={() => {
              if (activeTool === 'select') setSelectedId(ann.id)
            }}
            onDragEnd={(e) => {
              const dx = e.target.x()
              const dy = e.target.y()
              updateAnnotation(ann.id, {
                points: [
                  ann.points[0] + dx,
                  ann.points[1] + dy,
                  ann.points[2] + dx,
                  ann.points[3] + dy,
                ] as [number, number, number, number],
              })
              e.target.position({ x: 0, y: 0 })
            }}
          />
        )

      case 'rect':
        return (
          <Rect
            key={ann.id}
            id={ann.id}
            x={ann.x}
            y={ann.y}
            width={ann.width}
            height={ann.height}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            draggable={isDraggable}
            onClick={() => {
              if (activeTool === 'select') setSelectedId(ann.id)
            }}
            onDragEnd={(e) => {
              updateAnnotation(ann.id, {
                x: e.target.x(),
                y: e.target.y(),
              })
            }}
            onTransformEnd={() => handleTransformEnd(ann)}
          />
        )

      case 'ellipse':
        return (
          <Ellipse
            key={ann.id}
            id={ann.id}
            x={ann.x}
            y={ann.y}
            radiusX={ann.radiusX}
            radiusY={ann.radiusY}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            draggable={isDraggable}
            onClick={() => {
              if (activeTool === 'select') setSelectedId(ann.id)
            }}
            onDragEnd={(e) => {
              updateAnnotation(ann.id, {
                x: e.target.x(),
                y: e.target.y(),
              })
            }}
            onTransformEnd={() => handleTransformEnd(ann)}
          />
        )

      case 'mosaic':
        return <MosaicImage key={ann.id} ann={ann} />

      case 'step':
        return (
          <Group
            key={ann.id}
            id={ann.id}
            x={ann.x}
            y={ann.y}
            draggable={isDraggable}
            onClick={() => {
              if (activeTool === 'select') setSelectedId(ann.id)
            }}
            onDragEnd={(e) => {
              updateAnnotation(ann.id, {
                x: e.target.x(),
                y: e.target.y(),
              })
            }}
          >
            <Circle radius={16} fill={ann.color} stroke="#000" strokeWidth={2} />
            <Text
              x={-8}
              y={-9}
              text={String(ann.number)}
              fontSize={16}
              fontStyle="bold"
              fontFamily="monospace"
              fill="#fff"
              width={16}
              align="center"
              stroke="#000"
              strokeWidth={0.5}
            />
          </Group>
        )

      case 'badge': {
        const bc = BADGE_COLORS[ann.kind]
        return (
          <Group
            key={ann.id}
            id={ann.id}
            x={ann.x}
            y={ann.y}
            draggable={isDraggable}
            onClick={() => {
              if (activeTool === 'select') setSelectedId(ann.id)
            }}
            onDragEnd={(e) => {
              updateAnnotation(ann.id, {
                x: e.target.x(),
                y: e.target.y(),
              })
            }}
          >
            <Rect
              x={-24}
              y={-12}
              width={48}
              height={24}
              fill={bc.bg}
              cornerRadius={4}
              stroke="#000"
              strokeWidth={1}
            />
            <Text
              x={-24}
              y={-9}
              text={ann.kind}
              fontSize={14}
              fontStyle="bold"
              fontFamily="monospace"
              fill={bc.fg}
              width={48}
              align="center"
            />
          </Group>
        )
      }

      default:
        return null
    }
  }

  const cursorMap: Record<ToolType, string> = {
    select: 'default',
    pen: 'crosshair',
    text: 'text',
    arrow: 'crosshair',
    rect: 'crosshair',
    ellipse: 'crosshair',
    mosaic: 'crosshair',
    step: 'pointer',
    badge: 'pointer',
  }

  const anyRecording = isGifRecording || gifPreparing || gifEncoding

  // ---- Editor ----
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
      {/* Header bar */}
      <div
        style={{
          padding: '8px 12px',
          display: gifCountdown !== null ? 'none' : 'flex',
          gap: 10,
          alignItems: 'flex-start',
          width: '100%',
          justifyContent: 'center',
        }}
      >
        {/* Capture / Record buttons */}
        <div style={{
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          background: '#1a1a2e',
          borderRadius: 8,
          border: '1px solid #2a2a4a',
          padding: '4px 6px',
        }}>
          {/* New screenshot */}
          <button
            className="action-btn"
            onClick={handleNewCapture}
            disabled={anyRecording}
            style={{
              width: 38,
              height: 38,
              color: '#b0b0d0',
              flexDirection: 'column',
              gap: 1,
            }}
            title="新規スクリーンショット (Ctrl+Shift+S)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span style={{ fontSize: 8, lineHeight: 1 }}>New</span>
          </button>

          <div style={{ width: 1, height: 24, background: '#2a2a4a' }} />

          {/* GIF recording button */}
          {!isGifRecording ? (
            <button
              className="action-btn"
              onClick={handleRecordGif}
              disabled={anyRecording}
              style={{
                width: 38,
                height: 38,
                color: gifPreparing ? '#ff9100' : '#b0b0d0',
                background: gifPreparing ? 'rgba(255,145,0,0.15)' : 'transparent',
                flexDirection: 'column',
                gap: 1,
              }}
              title="画面録画（GIF）"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
              </svg>
              <span style={{ fontSize: 8, lineHeight: 1 }}>{gifPreparing ? 'Prep' : gifEncoding ? 'Encode' : 'Record'}</span>
            </button>
          ) : (
            <button
              className="action-btn"
              onClick={handleStopGif}
              style={{
                width: 38,
                height: 38,
                background: 'rgba(255,23,68,0.15)',
                color: '#ff1744',
                flexDirection: 'column',
                gap: 1,
                animation: 'pulse 1.5s infinite',
              }}
              title="録画を停止"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              <span style={{ fontSize: 8, lineHeight: 1, fontFamily: 'monospace', fontWeight: 700 }}>
                {gifElapsed}s
              </span>
            </button>
          )}

        </div>
        <Toolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          color={color}
          onColorChange={setColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setStrokeWidth}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          badgeKind={badgeKind}
          onBadgeKindChange={setBadgeKind}
          stepCounter={stepCounter}
          mosaicSize={mosaicSize}
          onMosaicSizeChange={setMosaicSize}
        />
      </div>

      {/* Canvas / GIF Preview / Empty state */}
      <div
        style={{
          flex: 1,
          display: gifCountdown !== null ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
        }}
      >
        {gifPreviewUrl ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img
              src={gifPreviewUrl}
              alt="GIF Preview"
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 180px)',
                border: '1px solid #2a2a4a',
                borderRadius: 4,
              }}
            />
            <button
              className="share-btn"
              onClick={() => setGifPreviewUrl(null)}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'rgba(0,0,0,0.7)',
                color: '#b0b0d0',
                fontSize: 11,
                padding: '4px 10px',
              }}
            >
              Close
            </button>
          </div>
        ) : !image ? (
          /* B12: Empty state welcome */
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4a4a6a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <h2>MarkShot</h2>
            <p>
              <kbd>Ctrl+Shift+S</kbd> または <strong>New</strong> ボタンでキャプチャ開始<br />
              <kbd>Record</kbd> ボタンでGIF録画<br /><br />
              <span style={{ color: '#555', fontSize: 11 }}>
                トレイアイコンのダブルクリックでもキャプチャできます
              </span>
            </p>
          </div>
        ) : (
          <div
            style={{
              border: '1px solid #2a2a4a',
              borderRadius: 4,
              overflow: 'hidden',
              cursor: cursorMap[activeTool],
            }}
          >
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              scaleX={stageScale}
              scaleY={stageScale}
              x={stagePos.x}
              y={stagePos.y}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onContextMenu={handleContextMenu}
              onWheel={handleWheel}
            >
              <Layer>
                <KonvaImage
                  image={image ?? undefined}
                  width={stageSize.width}
                  height={stageSize.height}
                />
              </Layer>
              <Layer>
                {annotations.map(renderAnnotation)}
                {renderDrawPreview()}
                <Transformer
                  ref={transformerRef}
                  borderStroke="#00FFFF"
                  borderStrokeWidth={1.5}
                  anchorStroke="#00FFFF"
                  anchorFill="#1a1a2e"
                  anchorSize={8}
                  rotateEnabled={false}
                  keepRatio={false}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                      return oldBox
                    }
                    return newBox
                  }}
                />
              </Layer>
            </Stage>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div style={{ padding: '8px 0', display: gifCountdown !== null ? 'none' : 'block' }}>
        <SharePanel onExportImage={exportImage} />
      </div>

      {/* Status message overlay */}
      {statusMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            borderRadius: 8,
            background: statusMsg.error ? 'rgba(255,0,85,0.9)' : 'rgba(57,255,20,0.9)',
            color: statusMsg.error ? '#fff' : '#000',
            fontSize: 13,
            fontWeight: 600,
            zIndex: 9998,
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* B4: GIF countdown overlay (visible on screen) */}
      {gifCountdown !== null && (
        <div className="gif-countdown-overlay">
          <div className="gif-countdown-number" key={gifCountdown}>
            {gifCountdown}
          </div>
        </div>
      )}

      {/* Zoom indicator */}
      {stageScale !== 1 && image && (
        <div
          style={{
            position: 'fixed',
            bottom: 60,
            right: 16,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(26, 26, 46, 0.9)',
            color: '#6c7086',
            fontSize: 11,
            fontFamily: 'monospace',
            border: '1px solid #2a2a4a',
            cursor: 'pointer',
          }}
          onClick={() => { setStageScale(1); setStagePos({ x: 0, y: 0 }) }}
          title="クリックでリセット"
        >
          {Math.round(stageScale * 100)}%
        </div>
      )}
    </div>
  )
}

export default AnnotationEditor
