import React, { useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

interface RecordingOverlayProps {
  region: { x: number; y: number; w: number; h: number; scaleFactor: number }
}

const RecordingOverlay: React.FC<RecordingOverlayProps> = ({ region }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [count, setCount] = useState(0)

  // 録画範囲の中心（CSS px）。カウントダウン数字をここに重ねる。
  const sf = window.devicePixelRatio || region.scaleFactor || 1
  const centerX = (region.x + region.w / 2) / sf
  const centerY = (region.y + region.h / 2) / sf

  // Rust から届くカウントダウン（3 → 2 → 1 → 0）。0 で非表示。
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    listen<number>('gif:countdown', (e) => setCount(e.payload)).then((u) => {
      unlisten = u
    })
    return () => {
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // region.{x,y,w,h} は当該モニタのローカル物理ピクセル。
    // RegionSelector 側は実測比 (screenshotImage.width / window.innerWidth) =
    // この WebView の実 devicePixelRatio で物理化しているので、逆変換も同じ
    // devicePixelRatio を使う。crate 由来の region.scaleFactor は Windows で
    // 実 DPR と一致しないことがあり、赤枠がズレる原因になる。
    const sf = window.devicePixelRatio || region.scaleFactor || 1
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
    <>
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
      {count > 0 && (
        <div
          key={count}
          style={{
            position: 'fixed',
            left: centerX,
            top: centerY,
            transform: 'translate(-50%, -50%)',
            fontSize: 140,
            fontWeight: 900,
            color: '#fff',
            textShadow: '0 0 40px rgba(255,23,68,0.9), 0 0 80px rgba(255,23,68,0.5)',
            fontFamily: 'monospace',
            animation: 'countdown-pop 1s ease-out',
            zIndex: 10000,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {count}
        </div>
      )}
    </>
  )
}

export default RecordingOverlay
