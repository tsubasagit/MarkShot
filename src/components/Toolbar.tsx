import React from 'react'
import type { ToolType } from '../hooks/useAnnotation'

interface ToolbarProps {
  tool: ToolType
  onToolChange: (t: ToolType) => void
  color: string
  onColorChange: (c: string) => void
  strokeWidth: number
  onStrokeWidthChange: (w: number) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onDone: () => void
  onCancel: () => void
}

// デフォルトは鮮やかなピンク #ed218b
export const PALETTE: string[] = [
  '#ed218b', // ピンク（既定）
  '#ff1744', // 赤
  '#2979ff', // 青
  '#00e676', // 緑
  '#ffea00', // 黄
  '#0f0f1a', // 黒
]

export const STROKE_PRESETS: { label: string; value: number }[] = [
  { label: '細', value: 2 },
  { label: '中', value: 4 },
  { label: '太', value: 8 },
]

const TOOLS: { id: ToolType; label: string }[] = [
  { id: 'select', label: '選択' },
  { id: 'arrow', label: '矢印' },
  { id: 'text', label: 'テキスト' },
  { id: 'rect', label: '枠' },
  { id: 'pen', label: 'ペン' },
  { id: 'mosaic', label: 'モザイク' },
]

type IconProps = { size?: number }
const svg = (size: number) =>
  ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  })

const ToolIcon: React.FC<{ type: ToolType } & IconProps> = ({ type, size = 18 }) => {
  const p = svg(size)
  switch (type) {
    case 'select':
      return (
        <svg {...p}>
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
          <path d="M13 13l6 6" />
        </svg>
      )
    case 'arrow':
      return (
        <svg {...p}>
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      )
    case 'text':
      return (
        <svg {...p} strokeWidth={2.5}>
          <path d="M6 4h12" />
          <path d="M12 4v16" />
        </svg>
      )
    case 'rect':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      )
    case 'pen':
      return (
        <svg {...p}>
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      )
    case 'mosaic':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      )
    default:
      return null
  }
}

const UndoIcon: React.FC<IconProps> = ({ size = 16 }) => (
  <svg {...svg(size)}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 3L3 13" />
  </svg>
)

const RedoIcon: React.FC<IconProps> = ({ size = 16 }) => (
  <svg {...svg(size)}>
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 13" />
  </svg>
)

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    background: '#1a1a2e',
    borderRadius: 8,
    border: '1px solid #2a2a4a',
    width: '100%',
    boxSizing: 'border-box',
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    paddingRight: 6,
    borderRight: '1px solid #2a2a4a',
  },
  iconBtn: {
    width: 32,
    height: 32,
    background: '#2a2a4a',
    color: '#e0e0f0',
    border: '1px solid #2a2a4a',
    borderRadius: 6,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  activeIcon: {
    background: '#00FFFF',
    color: '#0f0f1a',
    borderColor: '#00FFFF',
  },
  strokeBtn: {
    minWidth: 32,
    height: 32,
    padding: '0 8px',
    background: '#2a2a4a',
    color: '#e0e0f0',
    border: '1px solid #2a2a4a',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 4,
    cursor: 'pointer',
    border: '2px solid transparent',
    padding: 0,
  },
  swatchActive: { border: '2px solid #00FFFF' },
  spacer: { flex: 1 },
  doneBtn: {
    padding: '6px 14px',
    background: '#00FFFF',
    color: '#0f0f1a',
    border: '1px solid #00FFFF',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  cancelBtn: {
    padding: '6px 14px',
    background: 'transparent',
    color: '#b0b0d0',
    border: '1px solid #2a2a4a',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
}

const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDone,
  onCancel,
}) => {
  return (
    <div style={styles.bar}>
      <div style={styles.group}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            style={{ ...styles.iconBtn, ...(tool === t.id ? styles.activeIcon : null) }}
            onClick={() => onToolChange(t.id)}
            title={t.label}
            aria-label={t.label}
          >
            <ToolIcon type={t.id} />
          </button>
        ))}
      </div>

      <div style={styles.group}>
        {PALETTE.map((c) => (
          <button
            key={c}
            aria-label={`color ${c}`}
            title={c}
            style={{
              ...styles.swatch,
              background: c,
              ...(color === c ? styles.swatchActive : null),
            }}
            onClick={() => onColorChange(c)}
          />
        ))}
      </div>

      <div style={styles.group}>
        {STROKE_PRESETS.map((p) => (
          <button
            key={p.value}
            style={{ ...styles.strokeBtn, ...(strokeWidth === p.value ? styles.activeIcon : null) }}
            onClick={() => onStrokeWidthChange(p.value)}
            title={`太さ: ${p.value}px`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={styles.group}>
        <button
          style={{ ...styles.iconBtn, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'default' }}
          onClick={onUndo}
          disabled={!canUndo}
          title="元に戻す"
          aria-label="元に戻す"
        >
          <UndoIcon />
        </button>
        <button
          style={{ ...styles.iconBtn, opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'default' }}
          onClick={onRedo}
          disabled={!canRedo}
          title="やり直す"
          aria-label="やり直す"
        >
          <RedoIcon />
        </button>
      </div>

      <div style={styles.spacer} />

      <button style={styles.cancelBtn} onClick={onCancel}>
        キャンセル
      </button>
      <button style={styles.doneBtn} onClick={onDone}>
        完了
      </button>
    </div>
  )
}

export default Toolbar
