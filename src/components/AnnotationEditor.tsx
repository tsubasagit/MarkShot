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

const AnnotationEditor: React.FC<AnnotationEditorProps> = ({
  imageDataUrl,
}) => {
  const stageRef = useRef<Konva.Stage>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })

  const [activeTool, setActiveTool] = useState<ToolType>('select')
  const [color, setColor] = useState('#FF0055')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [fontSize, setFontSize] = useState(24)
  const [badgeKind, setBadgeKind] = useState<BadgeKind>('OK')

  const [isDrawing, setIsDrawing] = useState(false)
  const [currentPenPoints, setCurrentPenPoints] = useState<number[]>([])
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(
    null
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ text: string; error: boolean } | null>(null)

  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const recorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream } | null>(null)
  const timerRef = useRef<number | null>(null)

  // GIF recording state
  const [isGifRecording, setIsGifRecording] = useState(false)
  const [gifElapsed, setGifElapsed] = useState(0)
  const gifRef = useRef<{ stream: MediaStream; stop: () => void } | null>(null)
  const gifTimerRef = useRef<number | null>(null)

  // Scroll capture state
  const [isScrollCapturing, setIsScrollCapturing] = useState(false)
  const [scrollElapsed, setScrollElapsed] = useState(0)
  const scrollRef = useRef<{ stream: MediaStream; stop: () => void } | null>(null)
  const scrollTimerRef = useRef<number | null>(null)

  const {
    annotations,
    addAnnotation,
    updateAnnotation,
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
    const stage = stageRef.current
    if (!stage || !image) return null

    const scaleX = image.width / stageSize.width
    const scaleY = image.height / stageSize.height
    return stage.toDataURL({
      pixelRatio: Math.max(scaleX, scaleY),
      mimeType: 'image/png',
    })
  }, [image, stageSize])

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
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
        setActiveTool('select')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  // Cleanup recording timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (gifTimerRef.current) clearInterval(gifTimerRef.current)
      if (scrollTimerRef.current) clearInterval(scrollTimerRef.current)
    }
  }, [])

  // New screenshot with auto-save
  const handleNewCapture = async () => {
    console.log('[handleNewCapture] called, image:', !!image)
    try {
      if (image) {
        const dataUrl = exportImage()
        if (dataUrl) {
          await window.electronAPI?.autoSave(dataUrl)
        }
      }
      console.log('[handleNewCapture] calling startCapture')
      window.electronAPI?.startCapture()
    } catch (err) {
      console.error('[handleNewCapture] error:', err)
    }
  }

  // Video recording (manual stop)
  const handleRecordVideo = async () => {
    if (image) {
      const dataUrl = exportImage()
      if (dataUrl) {
        await window.electronAPI?.autoSave(dataUrl)
      }
    }

    window.electronAPI?.hideWindow()
    await new Promise((r) => setTimeout(r, 500))

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = async () => {
        // Cleanup timer
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setIsRecording(false)
        setRecordingElapsed(0)
        recorderRef.current = null

        try {
          const blob = new Blob(chunks, { type: 'video/webm' })
          const arrayBuffer = await blob.arrayBuffer()
          const result = await window.electronAPI.saveVideo(
            new Uint8Array(arrayBuffer)
          )
          window.electronAPI?.showWindow()
          showStatus(`動画を保存しました: ${result}`)
        } catch (err: any) {
          window.electronAPI?.showWindow()
          showStatus(`保存エラー: ${err.message}`, true)
        }
      }

      // Handle user stopping screen share from browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorderRef.current?.recorder.state === 'recording') {
          recorderRef.current.recorder.stop()
        }
      })

      recorder.start(1000)
      recorderRef.current = { recorder, stream }
      setIsRecording(true)
      setRecordingElapsed(0)
      timerRef.current = window.setInterval(() => {
        setRecordingElapsed((prev) => prev + 1)
      }, 1000)

      window.electronAPI?.showWindow()
    } catch (err: any) {
      window.electronAPI?.showWindow()
      if (err.name !== 'NotAllowedError') {
        showStatus(`録画エラー: ${err.message}`, true)
      }
    }
  }

  // Stop recording
  const handleStopRecording = () => {
    if (!recorderRef.current) return
    const { recorder, stream } = recorderRef.current
    if (recorder.state === 'recording') {
      recorder.stop()
    }
    stream.getTracks().forEach((t) => t.stop())
  }

  // GIF recording
  const handleRecordGif = async () => {
    if (image) {
      const dataUrl = exportImage()
      if (dataUrl) await window.electronAPI?.autoSave(dataUrl)
    }

    window.electronAPI?.hideWindow()
    await new Promise((r) => setTimeout(r, 500))

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })

      const videoTrack = stream.getVideoTracks()[0]
      const settings = videoTrack.getSettings()
      const srcW = settings.width || 800
      const srcH = settings.height || 600

      // Scale down if needed (max 800px wide)
      const MAX_W = 800
      const scale = srcW > MAX_W ? MAX_W / srcW : 1
      const w = Math.round(srcW * scale)
      const h = Math.round(srcH * scale)

      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      await video.play()

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!

      const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
      const gif = GIFEncoder()

      const FPS = 10
      const MAX_SECONDS = 30
      const frameDelay = Math.round(1000 / FPS)
      let frameCount = 0

      const captureInterval = window.setInterval(() => {
        if (frameCount >= MAX_SECONDS * FPS) {
          stopGif()
          return
        }
        ctx.drawImage(video, 0, 0, w, h)
        const imageData = ctx.getImageData(0, 0, w, h)
        const palette = quantize(imageData.data as unknown as Uint8ClampedArray, 256)
        const index = applyPalette(imageData.data as unknown as Uint8ClampedArray, palette)
        gif.writeFrame(index, w, h, { palette, delay: frameDelay })
        frameCount++
      }, frameDelay)

      const stopGif = async () => {
        clearInterval(captureInterval)
        if (gifTimerRef.current) {
          clearInterval(gifTimerRef.current)
          gifTimerRef.current = null
        }
        setIsGifRecording(false)
        setGifElapsed(0)
        gifRef.current = null

        video.pause()
        video.srcObject = null
        stream.getTracks().forEach((t) => t.stop())

        try {
          gif.finish()
          const bytes = gif.bytes()
          const result = await window.electronAPI.saveGif(bytes)
          window.electronAPI?.showWindow()
          showStatus(`GIFを保存しました: ${result}`)
        } catch (err: any) {
          window.electronAPI?.showWindow()
          showStatus(`GIF保存エラー: ${err.message}`, true)
        }
      }

      videoTrack.addEventListener('ended', () => {
        stopGif()
      })

      gifRef.current = { stream, stop: stopGif }
      setIsGifRecording(true)
      setGifElapsed(0)
      gifTimerRef.current = window.setInterval(() => {
        setGifElapsed((prev) => prev + 1)
      }, 1000)

      window.electronAPI?.showWindow()
    } catch (err: any) {
      window.electronAPI?.showWindow()
      if (err.name !== 'NotAllowedError') {
        showStatus(`GIF録画エラー: ${err.message}`, true)
      }
    }
  }

  const handleStopGif = () => {
    gifRef.current?.stop()
  }

  // Scroll capture
  const handleScrollCapture = async () => {
    if (image) {
      const dataUrl = exportImage()
      if (dataUrl) await window.electronAPI?.autoSave(dataUrl)
    }

    window.electronAPI?.hideWindow()
    await new Promise((r) => setTimeout(r, 500))

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })

      const videoTrack = stream.getVideoTracks()[0]
      const settings = videoTrack.getSettings()
      const srcW = settings.width || 800
      const srcH = settings.height || 600

      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      await video.play()

      const canvas = document.createElement('canvas')
      canvas.width = srcW
      canvas.height = srcH
      const ctx = canvas.getContext('2d')!

      const capturedFrames: ImageData[] = []
      const INTERVAL = 400 // ms

      const captureInterval = window.setInterval(() => {
        ctx.drawImage(video, 0, 0, srcW, srcH)
        const imageData = ctx.getImageData(0, 0, srcW, srcH)
        capturedFrames.push(imageData)
      }, INTERVAL)

      const stopScroll = async () => {
        clearInterval(captureInterval)
        if (scrollTimerRef.current) {
          clearInterval(scrollTimerRef.current)
          scrollTimerRef.current = null
        }
        setIsScrollCapturing(false)
        setScrollElapsed(0)
        scrollRef.current = null

        video.pause()
        video.srcObject = null
        stream.getTracks().forEach((t) => t.stop())

        window.electronAPI?.showWindow()

        if (capturedFrames.length === 0) {
          showStatus('フレームがキャプチャされませんでした', true)
          return
        }

        showStatus('スクロール画像を合成中...')

        try {
          const { removeDuplicateFrames, stitchFrames } = await import('../utils/scrollStitch')
          const unique = removeDuplicateFrames(capturedFrames)
          if (unique.length === 0) {
            showStatus('有効なフレームがありません', true)
            return
          }
          const dataUrl = stitchFrames(unique)
          if (dataUrl) {
            // Load stitched image into editor
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
              showStatus(`スクロールキャプチャ完了 (${unique.length}フレーム合成)`)
            }
            img.src = dataUrl
          }
        } catch (err: any) {
          showStatus(`合成エラー: ${err.message}`, true)
        }
      }

      videoTrack.addEventListener('ended', () => {
        stopScroll()
      })

      scrollRef.current = { stream, stop: stopScroll }
      setIsScrollCapturing(true)
      setScrollElapsed(0)
      scrollTimerRef.current = window.setInterval(() => {
        setScrollElapsed((prev) => prev + 1)
      }, 1000)

      window.electronAPI?.showWindow()
    } catch (err: any) {
      window.electronAPI?.showWindow()
      if (err.name !== 'NotAllowedError') {
        showStatus(`スクロールキャプチャエラー: ${err.message}`, true)
      }
    }
  }

  const handleStopScrollCapture = () => {
    scrollRef.current?.stop()
  }

  const getPointerPosition = (): { x: number; y: number } | null => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    return pos ? { x: pos.x, y: pos.y } : null
  }

  const handleStageMouseDown = () => {
    const pos = getPointerPosition()
    if (!pos) return

    if (activeTool === 'select') {
      const clickedOnEmpty = stageRef.current?.getIntersection(pos)
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
      setActiveTool('select')
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
            pixelSize: 10,
          })
        }
        break
      }
    }

    setDrawStart(null)
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
    textarea.style.left = `${stageRect.left + ann.x}px`
    textarea.style.top = `${stageRect.top + ann.y}px`
    textarea.style.fontSize = `${ann.fontSize}px`
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

  // Mosaic rendering
  const renderMosaic = (ann: Annotation & { type: 'mosaic' }) => {
    if (!image) return null
    const rects: React.ReactElement[] = []
    const ps = ann.pixelSize
    for (let y = 0; y < ann.height; y += ps) {
      for (let x = 0; x < ann.width; x += ps) {
        const shade =
          (Math.floor(x / ps) + Math.floor(y / ps)) % 2 === 0
            ? '#6c7086'
            : '#45475a'
        rects.push(
          <Rect
            key={`${ann.id}-${x}-${y}`}
            x={ann.x + x}
            y={ann.y + y}
            width={Math.min(ps, ann.width - x)}
            height={Math.min(ps, ann.height - y)}
            fill={shade}
          />
        )
      }
    }
    return rects
  }

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
            />
          </React.Fragment>
        )

      case 'arrow':
        return (
          <Arrow
            key={ann.id}
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
          />
        )

      case 'ellipse':
        return (
          <Ellipse
            key={ann.id}
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
          />
        )

      case 'mosaic':
        return (
          <React.Fragment key={ann.id}>
            {renderMosaic(ann)}
          </React.Fragment>
        )

      case 'step':
        return (
          <Group
            key={ann.id}
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

  const anyRecording = isRecording || isGifRecording || isScrollCapturing

  // Auto-start capture when no image is loaded (and no image is being loaded)
  const hasTriggeredCapture = useRef(false)
  useEffect(() => {
    if (!image && !imageDataUrl && !hasTriggeredCapture.current) {
      hasTriggeredCapture.current = true
      window.electronAPI?.startCapture()
    }
  }, [image, imageDataUrl])

  // ---- Editor with image ----
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
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          width: '100%',
          justifyContent: 'center',
        }}
      >
        {/* Capture / Record icon buttons */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={handleNewCapture}
            disabled={anyRecording}
            style={{
              width: 42,
              height: 42,
              border: '2px solid transparent',
              borderRadius: 6,
              background: 'transparent',
              color: '#b0b0d0',
              cursor: anyRecording ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
              opacity: anyRecording ? 0.3 : 1,
            }}
            title="新規スクリーンショット"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>

          {/* Video recording button */}
          {!isRecording ? (
            <button
              onClick={handleRecordVideo}
              disabled={anyRecording}
              style={{
                width: 42,
                height: 42,
                border: '2px solid transparent',
                borderRadius: 6,
                background: 'transparent',
                color: '#b0b0d0',
                cursor: anyRecording ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
                opacity: anyRecording ? 0.3 : 1,
              }}
              title="画面録画を開始"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>
              </svg>
            </button>
          ) : (
            <>
              <button
                onClick={handleStopRecording}
                style={{
                  width: 42,
                  height: 42,
                  border: '2px solid #ff1744',
                  borderRadius: 6,
                  background: 'rgba(255,23,68,0.15)',
                  color: '#ff1744',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
                title="録画を停止"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="5" width="14" height="14" rx="2"/>
                </svg>
              </button>
              <span style={{
                color: '#ff1744',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'monospace',
                minWidth: 28,
              }}>
                {recordingElapsed}s
              </span>
            </>
          )}

          {/* GIF recording button */}
          {!isGifRecording ? (
            <button
              onClick={handleRecordGif}
              disabled={anyRecording}
              style={{
                width: 42,
                height: 42,
                border: '2px solid transparent',
                borderRadius: 6,
                background: 'transparent',
                color: '#b0b0d0',
                cursor: anyRecording ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
                opacity: anyRecording ? 0.3 : 1,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'monospace',
              }}
              title="GIF録画を開始"
            >
              GIF
            </button>
          ) : (
            <>
              <button
                onClick={handleStopGif}
                style={{
                  width: 42,
                  height: 42,
                  border: '2px solid #ff9100',
                  borderRadius: 6,
                  background: 'rgba(255,145,0,0.15)',
                  color: '#ff9100',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
                title="GIF録画を停止"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="5" width="14" height="14" rx="2"/>
                </svg>
              </button>
              <span style={{
                color: '#ff9100',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'monospace',
                minWidth: 28,
              }}>
                {gifElapsed}s
              </span>
            </>
          )}

          {/* Scroll capture button */}
          {!isScrollCapturing ? (
            <button
              onClick={handleScrollCapture}
              disabled={anyRecording}
              style={{
                width: 42,
                height: 42,
                border: '2px solid transparent',
                borderRadius: 6,
                background: 'transparent',
                color: '#b0b0d0',
                cursor: anyRecording ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
                opacity: anyRecording ? 0.3 : 1,
              }}
              title="スクロールキャプチャ"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2"/>
                <line x1="12" y1="6" x2="12" y2="14"/>
                <polyline points="8 12 12 16 16 12"/>
              </svg>
            </button>
          ) : (
            <>
              <button
                onClick={handleStopScrollCapture}
                style={{
                  width: 42,
                  height: 42,
                  border: '2px solid #00e676',
                  borderRadius: 6,
                  background: 'rgba(0,230,118,0.15)',
                  color: '#00e676',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
                title="スクロールキャプチャを停止"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="5" width="14" height="14" rx="2"/>
                </svg>
              </button>
              <span style={{
                color: '#00e676',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'monospace',
                minWidth: 28,
              }}>
                {scrollElapsed}s
              </span>
            </>
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
        />
      </div>

      {/* Canvas */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
        }}
      >
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
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
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
            </Layer>
          </Stage>
        </div>
      </div>

      {/* Bottom panel */}
      <div style={{ padding: '8px 0' }}>
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
    </div>
  )
}

export default AnnotationEditor
