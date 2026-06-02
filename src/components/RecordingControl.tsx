import React, { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

const MAX_SECONDS = 60

const RecordingControl: React.FC = () => {
  const [elapsed, setElapsed] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed((prev) => Math.min(prev + 1, MAX_SECONDS))
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handlePauseResume = () => {
    if (isPaused) {
      invoke('resume_gif_recording').catch(() => {})
      timerRef.current = setInterval(() => {
        setElapsed((prev) => Math.min(prev + 1, MAX_SECONDS))
      }, 1000)
      setIsPaused(false)
    } else {
      invoke('pause_gif_recording').catch(() => {})
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setIsPaused(true)
    }
  }

  const handleStop = () => {
    invoke('stop_gif_recording').catch(() => {})
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        background: 'rgba(20, 20, 30, 0.95)',
        borderRadius: 10,
        border: `1px solid ${isPaused ? 'rgba(255, 193, 7, 0.5)' : 'rgba(255, 23, 68, 0.5)'}`,
        // @ts-ignore
        WebkitAppRegion: 'drag',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      {/* Pulsing red dot / paused indicator */}
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: isPaused ? '#ffc107' : '#ff1744',
          animation: isPaused ? 'none' : 'pulse-dot 1.5s infinite',
        }}
      />

      <span style={{ color: isPaused ? '#ffc107' : '#ff1744', fontSize: 12, fontWeight: 700 }}>
        {isPaused ? 'PAUSE' : 'REC'}
      </span>

      {/* Timer */}
      <span
        style={{
          fontFamily: 'monospace',
          fontSize: 16,
          fontWeight: 700,
          color: '#fff',
          minWidth: 40,
        }}
      >
        {formatTime(elapsed)}
        <span style={{ fontSize: 11, color: '#8a8aa0', fontWeight: 400 }}> / 1:00</span>
      </span>

      {/* Pause / Resume button */}
      <button
        onClick={handlePauseResume}
        style={{
          width: 28,
          height: 28,
          border: 'none',
          borderRadius: 6,
          background: isPaused ? 'rgba(255, 193, 7, 0.2)' : 'rgba(255, 255, 255, 0.15)',
          color: isPaused ? '#ffc107' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // @ts-ignore
          WebkitAppRegion: 'no-drag',
        }}
        title={isPaused ? '録画を再開' : '一時停止'}
      >
        {isPaused ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="4" width="5" height="16" rx="1" />
            <rect x="14" y="4" width="5" height="16" rx="1" />
          </svg>
        )}
      </button>

      {/* Stop button */}
      <button
        onClick={handleStop}
        style={{
          width: 28,
          height: 28,
          border: 'none',
          borderRadius: 6,
          background: 'rgba(255, 23, 68, 0.2)',
          color: '#ff1744',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // @ts-ignore
          WebkitAppRegion: 'no-drag',
        }}
        title="録画を停止"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
      </button>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}

export default RecordingControl
