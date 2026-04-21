import React, { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import RegionSelector from './components/RegionSelector'
import RecordingOverlay from './components/RecordingOverlay'
import RecordingControl from './components/RecordingControl'
import CountdownOverlay from './components/CountdownOverlay'
import CaptureBar from './components/CaptureBar'

type GifRegion = { x: number; y: number; w: number; h: number; scaleFactor: number }

const App: React.FC = () => {
  const [hash] = useState(() => window.location.hash)

  const isCapture = hash.startsWith('#/capture?') || hash === '#/capture'
  const isCaptureGif = hash.startsWith('#/capture-gif?') || hash === '#/capture-gif'
  const isRecordingOverlay = hash.startsWith('#/recording-overlay/')
  const isRecordingControl = hash === '#/recording-control'
  const isCountdown = hash === '#/countdown'
  const isOverlay = isCapture || isCaptureGif || isRecordingOverlay || isRecordingControl || isCountdown

  useEffect(() => {
    document.body.className = isOverlay ? 'capture-mode' : 'editor-mode'
  }, [isOverlay])

  if (isCapture) {
    return <RegionSelector />
  }

  if (isCaptureGif) {
    return <RegionSelector mode="gif" />
  }

  if (isRecordingOverlay) {
    const parts = hash.replace('#/recording-overlay/', '').split('/')
    const region: GifRegion = {
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

  if (isCountdown) {
    return <CountdownOverlay />
  }

  return <Placeholder />
}

function Placeholder() {
  const [captureMode, setCaptureMode] = useState<'screenshot' | 'gif'>('screenshot')
  const [captured, setCaptured] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let unlistenComplete: UnlistenFn | null = null
    let unlistenCancelled: UnlistenFn | null = null
    const setup = async () => {
      unlistenComplete = await listen<string>('capture:complete', (e) => {
        setCaptured(e.payload)
        setBusy(false)
        setError(null)
      })
      unlistenCancelled = await listen('capture:cancelled', () => {
        setBusy(false)
      })
    }
    setup()
    return () => {
      unlistenComplete?.()
      unlistenCancelled?.()
    }
  }, [])

  const handleNewCapture = async (mode?: 'screenshot' | 'gif') => {
    const m = mode ?? captureMode
    if (m === 'gif') {
      setError('GIF録画は Phase 2 で復活予定です')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('start_region_capture')
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

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
        <CaptureBar
          captureMode={captureMode}
          onCaptureModeChange={setCaptureMode}
          onNewCapture={handleNewCapture}
          disabled={busy}
        />
      </div>
      {captured ? (
        <div
          style={{
            flex: 1,
            width: '100%',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            overflow: 'auto',
          }}
        >
          <img
            src={captured}
            alt="captured"
            style={{ maxWidth: '100%', maxHeight: '100%', border: '1px solid #2a2a4a', borderRadius: 4 }}
          />
          <div style={{ fontSize: 11, color: '#6c7086' }}>
            クリップボードに PNG コピー済み（Ctrl+V で貼り付け可）
          </div>
        </div>
      ) : (
        <div className="empty-state" style={{ flex: 1 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4a4a6a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <h2>MarkShot</h2>
          <p>
            <strong>New</strong> ボタンで範囲選択開始<br />
            ドラッグで範囲指定 → クリップボードに PNG コピー<br />
            Esc / 右クリックでキャンセル
          </p>
          {busy && <p style={{ color: '#00FFFF' }}>オーバーレイ準備中…</p>}
          {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
        </div>
      )}
    </div>
  )
}

export default App
