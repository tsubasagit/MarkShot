import React from 'react'
import { ToolType, BadgeKind } from '../hooks/useAnnotation'

interface ToolbarProps {
  activeTool: ToolType
  onToolChange: (tool: ToolType) => void
  color: string
  onColorChange: (color: string) => void
  strokeWidth: number
  onStrokeWidthChange: (width: number) => void
  fontSize: number
  onFontSizeChange: (size: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  badgeKind: BadgeKind
  onBadgeKindChange: (kind: BadgeKind) => void
  stepCounter: number
}

const ToolIcon: React.FC<{ type: ToolType; stepCounter?: number }> = ({ type, stepCounter }) => {
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  switch (type) {
    case 'select':
      return <svg {...props}><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
    case 'pen':
      return <svg {...props}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
    case 'text':
      return <svg {...props} strokeWidth={2.5}><path d="M6 4h12"/><path d="M12 4v16"/></svg>
    case 'arrow':
      return <svg {...props}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
    case 'rect':
      return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
    case 'ellipse':
      return <svg {...props}><ellipse cx="12" cy="12" rx="10" ry="8"/></svg>
    case 'mosaic':
      return <svg {...props}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
    case 'step':
      return <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace' }}>{stepCounter}</span>
    case 'badge':
      return <svg {...props}><path d="M12 2L3 7v6c0 5.25 3.75 10.13 9 11.38C17.25 23.13 21 18.25 21 13V7l-9-5z"/></svg>
    default:
      return null
  }
}

const TOOLS: { type: ToolType; label: string; shortcut: string }[] = [
  { type: 'select', label: '選択', shortcut: 'V' },
  { type: 'pen', label: 'ペン', shortcut: 'P' },
  { type: 'text', label: 'テキスト', shortcut: 'T' },
  { type: 'arrow', label: '矢印', shortcut: 'A' },
  { type: 'rect', label: '矩形', shortcut: 'R' },
  { type: 'ellipse', label: '楕円', shortcut: 'E' },
  { type: 'mosaic', label: 'モザイク', shortcut: 'M' },
  { type: 'step', label: 'ステップ番号', shortcut: 'S' },
  { type: 'badge', label: 'バッジ', shortcut: 'B' },
]

const BADGE_KINDS: { kind: BadgeKind; label: string; bg: string }[] = [
  { kind: 'OK', label: 'OK', bg: '#00e676' },
  { kind: 'NG', label: 'NG', bg: '#ff1744' },
  { kind: 'WARN', label: 'WARN', bg: '#ffea00' },
  { kind: 'INFO', label: 'INFO', bg: '#00b0ff' },
  { kind: 'BUG', label: 'BUG', bg: '#ff9100' },
]

// High-visibility fluorescent + standard colors
const PRESET_COLORS = [
  '#FF0055', '#FF3300', '#FF6600', '#FFFF00', '#39FF14',
  '#00FFFF', '#0066FF', '#FF00FF', '#FFFFFF', '#000000',
]

const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  fontSize,
  onFontSizeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  badgeKind,
  onBadgeKindChange,
  stepCounter,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: '#1a1a2e',
        borderRadius: 8,
        boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
        border: '1px solid #2a2a4a',
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {/* Tool buttons */}
        {TOOLS.map((tool) => (
          <button
            key={tool.type}
            className={`tool-btn ${activeTool === tool.type ? 'active' : ''}`}
            onClick={() => onToolChange(tool.type)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            <ToolIcon type={tool.type} stepCounter={stepCounter} />
          </button>
        ))}

        <div style={{ width: 1, height: 26, background: '#2a2a4a', margin: '0 3px' }} />

        {/* Color palette */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              className={`color-btn ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => onColorChange(c)}
              title={c}
            />
          ))}
          <input
            type="color"
            className="color-picker-input"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            title="カスタムカラー"
          />
        </div>

        <div style={{ width: 1, height: 26, background: '#2a2a4a', margin: '0 3px' }} />

        {/* Stroke width (for pen/arrow/rect/ellipse) */}
        {activeTool !== 'text' &&
          activeTool !== 'select' &&
          activeTool !== 'step' &&
          activeTool !== 'badge' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#6c7086', fontSize: 10, whiteSpace: 'nowrap' }}>太さ</span>
              <input
                type="range"
                className="ms-slider"
                min={1}
                max={20}
                value={strokeWidth}
                onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
              />
              <span style={{ color: '#6c7086', fontSize: 10, width: 18, textAlign: 'center', fontFamily: 'monospace' }}>{strokeWidth}</span>
            </div>
          )}

        {/* Font size (for text) */}
        {activeTool === 'text' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#6c7086', fontSize: 10, whiteSpace: 'nowrap' }}>サイズ</span>
            <input
              type="range"
              className="ms-slider"
              min={12}
              max={72}
              value={fontSize}
              onChange={(e) => onFontSizeChange(Number(e.target.value))}
            />
            <span style={{ color: '#6c7086', fontSize: 10, width: 22, textAlign: 'center', fontFamily: 'monospace' }}>{fontSize}</span>
          </div>
        )}

        <div style={{ width: 1, height: 26, background: '#2a2a4a', margin: '0 3px' }} />

        {/* Undo/Redo */}
        <button
          className="undo-redo-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="元に戻す (Ctrl+Z)"
        >
          ↩
        </button>
        <button
          className="undo-redo-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="やり直し (Ctrl+Y)"
        >
          ↪
        </button>
      </div>

      {/* Badge kind selector (shown when badge tool is active) */}
      {activeTool === 'badge' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          background: '#1a1a2e',
          borderRadius: 6,
          border: '1px solid #2a2a4a',
        }}>
          <span style={{ color: '#6c7086', fontSize: 10, marginRight: 4 }}>バッジ種類:</span>
          {BADGE_KINDS.map((b) => (
            <button
              key={b.kind}
              className={`badge-btn ${badgeKind === b.kind ? 'active' : ''}`}
              style={{
                background: b.bg,
                color: b.kind === 'WARN' || b.kind === 'OK' ? '#000' : '#fff',
              }}
              onClick={() => onBadgeKindChange(b.kind)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default Toolbar
