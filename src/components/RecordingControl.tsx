import React, { useState, useEffect } from 'react'

const RecordingControl: React.FC = () => {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleStop = () => {
    window.electronAPI?.stopRecordingFromControl()
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
        border: '1px solid rgba(255, 23, 68, 0.5)',
        // @ts-ignore
        WebkitAppRegion: 'drag',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      {/* Pulsing red dot */}
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#ff1744',
          animation: 'pulse-dot 1.5s infinite',
        }}
      />

      <span style={{ color: '#ff1744', fontSize: 12, fontWeight: 700 }}>REC</span>

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
      </span>

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
