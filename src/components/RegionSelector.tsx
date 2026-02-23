import React, { useState, useEffect, useRef, useCallback } from 'react'

interface Region {
  startX: number
  startY: number
  endX: number
  endY: number
}

interface RegionSelectorProps {
  mode?: 'screenshot' | 'gif'
}

const RegionSelector: React.FC<RegionSelectorProps> = ({ mode = 'screenshot' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [screenshotImage, setScreenshotImage] = useState<HTMLImageElement | null>(null)
  const [displayInfo, setDisplayInfo] = useState<{
    width: number
    height: number
    scaleFactor: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [region, setRegion] = useState<Region | null>(null)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    // Register the screenshot data listener FIRST
    const cleanupScreenshot = window.electronAPI?.onScreenshotData((dataUrl, info) => {
      setScreenshotImage(null)
      setDisplayInfo(info)
      const img = new Image()
      img.onload = () => {
        setScreenshotImage(img)
        // キャンバス描画完了後にウィンドウを表示する（描画前だとクリックが素通りする）
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

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    // Draw the screenshot
    ctx.drawImage(screenshotImage, 0, 0, canvas.width, canvas.height)

    // Draw dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // If region is selected, clear the selected area
    if (region) {
      const x = Math.min(region.startX, region.endX)
      const y = Math.min(region.startY, region.endY)
      const w = Math.abs(region.endX - region.startX)
      const h = Math.abs(region.endY - region.startY)

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

  useEffect(() => {
    draw()
  }, [draw])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return // 右クリックは無視
    setIsDragging(true)
    setStartPos({ x: e.clientX, y: e.clientY })
    setRegion({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
    })
  }

  // 右クリックでキャプチャをキャンセル
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(false)
    setRegion(null)
    window.electronAPI?.cancelCapture()
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY })
    if (!isDragging) return
    setRegion({
      startX: startPos.x,
      startY: startPos.y,
      endX: e.clientX,
      endY: e.clientY,
    })
  }

  const handleMouseUp = () => {
    if (!isDragging || !region || !screenshotImage) return
    setIsDragging(false)

    const x = Math.min(region.startX, region.endX)
    const y = Math.min(region.startY, region.endY)
    const w = Math.abs(region.endX - region.startX)
    const h = Math.abs(region.endY - region.startY)

    if (w < 10 || h < 10) {
      setRegion(null)
      return
    }

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
