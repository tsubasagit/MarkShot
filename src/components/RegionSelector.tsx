import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  createInitialState,
  resetState,
  onPointerDown as logicPointerDown,
  onPointerMove as logicPointerMove,
  onPointerUp as logicPointerUp,
  type SelectionState,
} from '@/utils/regionSelectionLogic'

interface Region {
  startX: number
  startY: number
  endX: number
  endY: number
}

interface RegionSelectorProps {
  mode?: 'screenshot' | 'gif'
}

const INPUT_COOLDOWN_MS = 280

function selectionToRegion(s: SelectionState): Region | null {
  if (!s.isDragging) return null
  return {
    startX: s.startPos.x,
    startY: s.startPos.y,
    endX: s.currentEnd.x,
    endY: s.currentEnd.y,
  }
}

const RegionSelector: React.FC<RegionSelectorProps> = ({ mode = 'screenshot' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectionFrameRef = useRef<HTMLDivElement>(null)
  const selectionStateRef = useRef<SelectionState>(createInitialState())
  const inputReadyAtRef = useRef(0)
  const drawRef = useRef<() => void>(() => {})
  const drawRetryCountRef = useRef(0)
  const MAX_DRAW_RETRY = 60
  const screenshotImageRef = useRef<HTMLImageElement | null>(null)
  const overlayPaintedSentRef = useRef(false)
  const successfulDrawsRef = useRef(0)
  const [screenshotImage, setScreenshotImage] = useState<HTMLImageElement | null>(null)
  const [displayInfo, setDisplayInfo] = useState<{
    width: number
    height: number
    scaleFactor: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [region, setRegion] = useState<Region | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const forceHideFrameRef = useRef(false)

  useEffect(() => {
    const cleanupScreenshot = window.electronAPI?.onScreenshotData((dataUrl, info) => {
      forceHideFrameRef.current = true
      setDisplayInfo(info)
      selectionStateRef.current = resetState(selectionStateRef.current)
      inputReadyAtRef.current = Date.now() + INPUT_COOLDOWN_MS
      const img = new Image()
      img.onload = () => {
        drawRetryCountRef.current = 0
        overlayPaintedSentRef.current = false
        successfulDrawsRef.current = 0
        setScreenshotImage(img)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.electronAPI?.notifyScreenshotLoaded()
          })
        })
      }
      img.src = dataUrl
    })

    // THEN tell main process we're ready to receive
    window.electronAPI?.notifyOverlayReady()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.electronAPI?.cancelCapture()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      cleanupScreenshot?.()
    }
  }, [])

  // Draw overlay and selection
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !screenshotImage) return

    const w = window.innerWidth
    const h = window.innerHeight
    if (w <= 0 || h <= 0) {
      if (drawRetryCountRef.current < MAX_DRAW_RETRY) {
        drawRetryCountRef.current += 1
        requestAnimationFrame(() => drawRef.current())
      }
      return
    }
    drawRetryCountRef.current = 0

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = w
    canvas.height = h
    successfulDrawsRef.current += 1

    // Draw the screenshot
    ctx.drawImage(screenshotImage, 0, 0, canvas.width, canvas.height)

    // Draw dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 選択枠は ref の最新値で描画（state の更新遅延でプライマリで枠が消えるのを防ぐ）
    const sel = selectionStateRef.current
    const regionToDraw = selectionToRegion(sel) ?? region
    if (regionToDraw || sel.isDragging) {
      const x = regionToDraw
        ? Math.min(regionToDraw.startX, regionToDraw.endX)
        : sel.startPos.x
      const y = regionToDraw
        ? Math.min(regionToDraw.startY, regionToDraw.endY)
        : sel.startPos.y
      let w = regionToDraw
        ? Math.abs(regionToDraw.endX - regionToDraw.startX)
        : 0
      let h = regionToDraw
        ? Math.abs(regionToDraw.endY - regionToDraw.startY)
        : 0
      if (sel.isDragging) {
        w = Math.max(2, w)
        h = Math.max(2, h)
      }

      if (w > 0 && h > 0) {
        ctx.clearRect(x, y, w, h)
        const scaleX = screenshotImage.width / canvas.width
        const scaleY = screenshotImage.height / canvas.height
        ctx.drawImage(
          screenshotImage,
          x * scaleX, y * scaleY, w * scaleX, h * scaleY,
          x, y, w, h
        )

        // Selection border
        ctx.strokeStyle = '#00FFFF'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.strokeRect(x, y, w, h)
        ctx.setLineDash([])

        // Dimension label
        const actualW = Math.round(w * (displayInfo?.scaleFactor || 1))
        const actualH = Math.round(h * (displayInfo?.scaleFactor || 1))
        const label = `${actualW} x ${actualH}`
        ctx.font = '13px Segoe UI, Meiryo'
        const textWidth = ctx.measureText(label).width
        const labelX = x + w / 2 - textWidth / 2 - 6
        const labelY = y + h + 6
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
        ctx.fillRect(labelX, labelY, textWidth + 12, 22)
        ctx.fillStyle = '#00FFFF'
        ctx.fillText(label, labelX + 6, labelY + 16)
      }
    }

    // Draw custom crosshair cursor
    if (mousePos) {
      const { x: mx, y: my } = mousePos
      const armLen = 20
      const gap = 6
      const lineW = 2

      // Outer stroke (dark) for contrast
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.lineWidth = lineW + 2
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(mx - armLen, my); ctx.lineTo(mx - gap, my)
      ctx.moveTo(mx + gap, my); ctx.lineTo(mx + armLen, my)
      ctx.moveTo(mx, my - armLen); ctx.lineTo(mx, my - gap)
      ctx.moveTo(mx, my + gap); ctx.lineTo(mx, my + armLen)
      ctx.stroke()

      // Inner stroke (bright cyan)
      ctx.strokeStyle = '#00FFFF'
      ctx.lineWidth = lineW
      ctx.beginPath()
      ctx.moveTo(mx - armLen, my); ctx.lineTo(mx - gap, my)
      ctx.moveTo(mx + gap, my); ctx.lineTo(mx + armLen, my)
      ctx.moveTo(mx, my - armLen); ctx.lineTo(mx, my - gap)
      ctx.moveTo(mx, my + gap); ctx.lineTo(mx, my + armLen)
      ctx.stroke()

      // Center dot
      ctx.fillStyle = '#00FFFF'
      ctx.beginPath()
      ctx.arc(mx, my, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [screenshotImage, region, displayInfo, mousePos])

  drawRef.current = draw
  screenshotImageRef.current = screenshotImage

  // マウント時から rAF ループを止めない。選択枠は DOM の div でも同期更新（キャンバス描画が抜けても枠は見えるようにする）
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      drawRef.current()
      const s = selectionStateRef.current
      const el = selectionFrameRef.current
      if (forceHideFrameRef.current && el) {
        el.style.display = 'none'
        forceHideFrameRef.current = false
      }
      if (el) {
        if (s.isDragging) {
          const x = Math.min(s.startPos.x, s.currentEnd.x)
          const y = Math.min(s.startPos.y, s.currentEnd.y)
          const w = Math.max(2, Math.abs(s.currentEnd.x - s.startPos.x))
          const h = Math.max(2, Math.abs(s.currentEnd.y - s.startPos.y))
          el.style.display = 'block'
          el.style.left = x + 'px'
          el.style.top = y + 'px'
          el.style.width = w + 'px'
          el.style.height = h + 'px'
        } else {
          el.style.display = 'none'
        }
      }
      if (screenshotImageRef.current && !overlayPaintedSentRef.current && successfulDrawsRef.current >= 4) {
        window.electronAPI?.notifyOverlayPainted?.()
        overlayPaintedSentRef.current = true
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return
    window.electronAPI?.bringOverlayToFront?.()
    if (selectionStateRef.current.isDragging) return
    if (Date.now() < inputReadyAtRef.current) return
    const pt = { x: e.clientX, y: e.clientY }
    selectionStateRef.current = logicPointerDown(selectionStateRef.current, pt)
    setRegion(selectionToRegion(selectionStateRef.current))
    setIsDragging(selectionStateRef.current.isDragging)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    selectionStateRef.current = createInitialState()
    setIsDragging(false)
    setRegion(null)
    window.electronAPI?.cancelCapture()
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY })
    const pt = { x: e.clientX, y: e.clientY }
    selectionStateRef.current = logicPointerMove(selectionStateRef.current, pt)
    const nowDragging = selectionStateRef.current.isDragging
    setRegion(selectionToRegion(selectionStateRef.current))
    setIsDragging(nowDragging)
  }

  const handleMouseUp = () => {
    const result = logicPointerUp(selectionStateRef.current)
    selectionStateRef.current = resetState(selectionStateRef.current)
    setRegion(null)
    setIsDragging(false)

    if (!result.send || !screenshotImage || !('rect' in result)) return
    const { x, y, w, h } = result.rect

    if (mode === 'gif') {
      // GIF mode: send region coordinates (in physical pixels) instead of cropped image
      const scaleFactor = displayInfo?.scaleFactor || 1
      window.electronAPI?.sendGifRegion({
        x: Math.round(x * scaleFactor),
        y: Math.round(y * scaleFactor),
        w: Math.round(w * scaleFactor),
        h: Math.round(h * scaleFactor),
        scaleFactor,
      })
      return
    }

    // Screenshot mode: crop and send image
    const cropCanvas = document.createElement('canvas')
    const scaleX = screenshotImage.width / window.innerWidth
    const scaleY = screenshotImage.height / window.innerHeight
    cropCanvas.width = Math.round(w * scaleX)
    cropCanvas.height = Math.round(h * scaleY)

    const cropCtx = cropCanvas.getContext('2d')
    if (cropCtx) {
      cropCtx.drawImage(
        screenshotImage,
        Math.round(x * scaleX),
        Math.round(y * scaleY),
        cropCanvas.width,
        cropCanvas.height,
        0,
        0,
        cropCanvas.width,
        cropCanvas.height
      )

      const croppedDataUrl = cropCanvas.toDataURL('image/png')
      window.electronAPI?.copyImage(croppedDataUrl)
      window.electronAPI?.sendRegionSelected(croppedDataUrl)
    }
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          cursor: 'none',
          zIndex: 9999,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
      />
      <div
        ref={selectionFrameRef}
        aria-hidden
        style={{
          position: 'fixed',
          display: 'none',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          boxSizing: 'border-box',
          border: '2px dashed #00FFFF',
          pointerEvents: 'none',
          zIndex: 10000,
        }}
      />
      {!isDragging && !region && screenshotImage && (
        <div className="region-hint">
          ドラッグして範囲を選択<br />
          <kbd>右クリック</kbd> or <kbd>Esc</kbd> でキャンセル
        </div>
      )}
    </>
  )
}

export default RegionSelector
