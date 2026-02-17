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

const TOOLS: { type: ToolType; label: string; icon: string }[] = [
  { type: 'select', label: '選択', icon: '↖' },
  { type: 'pen', label: 'ペン', icon: '✏' },
  { type: 'text', label: 'テキスト', icon: 'T' },
  { type: 'arrow', label: '矢印', icon: '→' },
  { type: 'rect', label: '矩形', icon: '□' },
  { type: 'ellipse', label: '楕円', icon: '○' },
  { type: 'mosaic', label: 'モザイク', icon: '▦' },
  { type: 'step', label: 'ステップ番号', icon: '#' },
  { type: 'badge', label: 'バッジ', icon: '!' },
]

const BADGE_KINDS: { kind: BadgeKind; label: string; bg: string }[] = [
  { kind: 'OK', label: 'OK', bg: '#00e676' },
  { kind: 'NG', label: 'NG', bg: '#ff1744' },
  { kind: 'WARN', label: 'WARN', bg: '#ffea00' },
  { kind: 'INFO', label: 'INFO', bg: '#00b0ff' },
  { kind: 'BUG', label: 'BUG', bg: '#ff9100' },
]

// High-visibility fluorescent + standard colors for dark/light backgrounds
const PRESET_COLORS = [
  '#FF0055', // neon pink (hot pink)
  '#FF3300', // neon red-orange
  '#FF6600', // bright orange
  '#FFFF00', // neon yellow
  '#39FF14', // neon green
  '#00FFFF', // cyan
  '#0066FF', // vivid blue
  '#FF00FF', // magenta
  '#FFFFFF', // white
  '#000000', // black
]

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    alignItems: 'center',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    background: '#1a1a2e',
    borderRadius: 8,
    boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    border: '1px solid #2a2a4a',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
  },
  toolBtn: {
    width: 42,
    height: 42,
    border: '2px solid transparent',
    borderRadius: 6,
    background: 'transparent',
    color: '#b0b0d0',
    fontSize: 17,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },
  toolBtnActive: {
    background: '#2a2a4a',
    borderColor: '#00FFFF',
    color: '#00FFFF',
  },
  divider: {
    width: 1,
    height: 26,
    background: '#2a2a4a',
    margin: '0 3px',
  },
  colorBtn: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: '2px solid transparent',
    cursor: 'pointer',
    transition: 'transform 0.15s',
  },
  colorBtnActive: {
    border: '2px solid #fff',
    transform: 'scale(1.25)',
    boxShadow: '0 0 6px rgba(255,255,255,0.5)',
  },
  slider: {
    width: 50,
    accentColor: '#00FFFF',
  },
  undoRedoBtn: {
    width: 30,
    height: 30,
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: '#b0b0d0',
    fontSize: 15,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.3,
    cursor: 'default',
  },
  label: {
    color: '#6c7086',
    fontSize: 10,
    whiteSpace: 'nowrap' as const,
  },
  badgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    background: '#1a1a2e',
    borderRadius: 6,
    border: '1px solid #2a2a4a',
  },
  badgeBtn: {
    padding: '3px 8px',
    borderRadius: 4,
    border: '2px solid transparent',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'monospace',
    transition: 'all 0.15s',
  },
}

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
    <div style={styles.container}>
      <div style={styles.toolbar}>
        {/* Tool buttons */}
        {TOOLS.map((tool) => (
          <button
            key={tool.type}
            style={{
              ...styles.toolBtn,
              ...(activeTool === tool.type ? styles.toolBtnActive : {}),
            }}
            onClick={() => onToolChange(tool.type)}
            title={tool.label}
          >
            {tool.type === 'step' ? (
              <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace' }}>
                {stepCounter}
              </span>
            ) : (
              tool.icon
            )}
          </button>
        ))}

        <div style={styles.divider} />

        {/* Color palette */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              style={{
                ...styles.colorBtn,
                background: c,
                ...(color === c ? styles.colorBtnActive : {}),
              }}
              onClick={() => onColorChange(c)}
              title={c}
            />
          ))}
        </div>

        <div style={styles.divider} />

        {/* Stroke width (for pen/arrow/rect/ellipse) */}
        {activeTool !== 'text' &&
          activeTool !== 'select' &&
          activeTool !== 'step' &&
          activeTool !== 'badge' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={styles.label}>太さ</span>
              <input
                type="range"
                min={1}
                max={20}
                value={strokeWidth}
                onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
                style={styles.slider}
              />
            </div>
          )}

        {/* Font size (for text) */}
        {activeTool === 'text' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={styles.label}>サイズ</span>
            <input
              type="range"
              min={12}
              max={72}
              value={fontSize}
              onChange={(e) => onFontSizeChange(Number(e.target.value))}
              style={styles.slider}
            />
            <span style={{ ...styles.label, width: 22, textAlign: 'center' }}>{fontSize}</span>
          </div>
        )}

        <div style={styles.divider} />

        {/* Undo/Redo */}
        <button
          style={{
            ...styles.undoRedoBtn,
            ...(canUndo ? {} : styles.disabled),
          }}
          onClick={onUndo}
          disabled={!canUndo}
          title="元に戻す (Ctrl+Z)"
        >
          ↩
        </button>
        <button
          style={{
            ...styles.undoRedoBtn,
            ...(canRedo ? {} : styles.disabled),
          }}
          onClick={onRedo}
          disabled={!canRedo}
          title="やり直し (Ctrl+Y)"
        >
          ↪
        </button>
      </div>

      {/* Badge kind selector (shown when badge tool is active) */}
      {activeTool === 'badge' && (
        <div style={styles.badgeRow}>
          <span style={{ ...styles.label, marginRight: 4 }}>バッジ種類:</span>
          {BADGE_KINDS.map((b) => (
            <button
              key={b.kind}
              style={{
                ...styles.badgeBtn,
                background: b.bg,
                color: b.kind === 'WARN' || b.kind === 'OK' ? '#000' : '#fff',
                borderColor: badgeKind === b.kind ? '#fff' : 'transparent',
                transform: badgeKind === b.kind ? 'scale(1.1)' : 'scale(1)',
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
