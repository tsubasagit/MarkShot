import React, { useEffect, useRef } from 'react'

interface RecordingOverlayProps {
  region: { x: number; y: number; w: number; h: number; scaleFactor: number }
}

const RecordingOverlay: React.FC<RecordingOverlayProps> = ({ region }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const sf = region.scaleFactor
    const rx = region.x / sf
    const ry = region.y / sf
    const rw = region.w / sf
    const rh = region.h / sf

    // Semi-transparent dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Clear the recording region (transparent)
    ctx.clearRect(rx, ry, rw, rh)

    // Red dashed border around region (drawn outside)
    ctx.strokeStyle = '#ff1744'
    ctx.lineWidth = 3
    ctx.setLineDash([8, 4])
    ctx.strokeRect(rx - 3, ry - 3, rw + 6, rh + 6)
    ctx.setLineDash([])
  }, [region])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
      }}
    />
  )
}

export default RecordingOverlay
