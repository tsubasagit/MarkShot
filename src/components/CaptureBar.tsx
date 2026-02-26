import React from 'react'

export type CaptureMode = 'screenshot' | 'gif'

interface CaptureBarProps {
  captureMode: CaptureMode
  onCaptureModeChange: (mode: CaptureMode) => void
  onNewCapture: () => void
  disabled?: boolean
}

/**
 * エディタと同じ見た目の「New」ボタン + Screenshot|GIF トグル。
 * プレースホルダーとエディタで共通表示するため共有コンポーネント化。
 */
const CaptureBar: React.FC<CaptureBarProps> = ({
  captureMode,
  onCaptureModeChange,
  onNewCapture,
  disabled = false,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        alignItems: 'center',
        background: '#1a1a2e',
        borderRadius: 8,
        border: '1px solid #2a2a4a',
        padding: '4px 6px',
      }}
    >
      <button
        type="button"
        className="action-btn"
        onClick={onNewCapture}
        disabled={disabled}
        style={{
          width: 38,
          height: 38,
          color: '#b0b0d0',
          background: 'transparent',
          flexDirection: 'column',
          gap: 1,
        }}
        title={captureMode === 'gif' ? '新規GIF録画' : '新規スクリーンショット'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span style={{ fontSize: 8, lineHeight: 1 }}>New</span>
      </button>

      <div style={{ width: 1, height: 24, background: '#2a2a4a' }} />

      <div
        style={{
          display: 'flex',
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid #2a2a4a',
        }}
      >
        <button
          type="button"
          className="action-btn"
          onClick={() => onCaptureModeChange('screenshot')}
          disabled={disabled}
          style={{
            height: 30,
            padding: '0 8px',
            fontSize: 10,
            fontWeight: 600,
            borderRadius: 0,
            color: captureMode === 'screenshot' ? '#0f0f1a' : '#6c7086',
            background: captureMode === 'screenshot' ? '#00FFFF' : 'transparent',
          }}
          title="スクリーンショットモード"
        >
          Screenshot
        </button>
        <button
          type="button"
          className="action-btn"
          onClick={() => onCaptureModeChange('gif')}
          disabled={disabled}
          style={{
            height: 30,
            padding: '0 8px',
            fontSize: 10,
            fontWeight: 600,
            borderRadius: 0,
            color: captureMode === 'gif' ? '#0f0f1a' : '#6c7086',
            background: captureMode === 'gif' ? '#ff9100' : 'transparent',
          }}
          title="GIF録画モード"
        >
          GIF
        </button>
      </div>
    </div>
  )
}

export default CaptureBar
