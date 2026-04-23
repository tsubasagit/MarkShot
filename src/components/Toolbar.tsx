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

export const PALETTE: string[] = ['#ff1744', '#2979ff', '#00e676', '#ffea00', '#0f0f1a']
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
  btn: {
    padding: '6px 10px',
    background: '#2a2a4a',
    color: '#e0e0f0',
    border: '1px solid #2a2a4a',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  active: {
    background: '#00FFFF',
    color: '#0f0f1a',
    borderColor: '#00FFFF',
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
  primary: { background: '#00FFFF', color: '#0f0f1a', borderColor: '#00FFFF' },
  ghost: { background: 'transparent', color: '#b0b0d0', borderColor: '#2a2a4a' },
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
            style={{ ...styles.btn, ...(tool === t.id ? styles.active : null) }}
            onClick={() => onToolChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={styles.group}>
        {PALETTE.map((c) => (
          <button
            key={c}
            aria-label={`color ${c}`}
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
            style={{ ...styles.btn, ...(strokeWidth === p.value ? styles.active : null) }}
            onClick={() => onStrokeWidthChange(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={styles.group}>
        <button
          style={{ ...styles.btn, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'default' }}
          onClick={onUndo}
          disabled={!canUndo}
        >
          ↶ 戻る
        </button>
        <button
          style={{ ...styles.btn, opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'default' }}
          onClick={onRedo}
          disabled={!canRedo}
        >
          ↷ 進む
        </button>
      </div>

      <div style={styles.spacer} />

      <button style={{ ...styles.btn, ...styles.ghost }} onClick={onCancel}>
        キャンセル
      </button>
      <button style={{ ...styles.btn, ...styles.primary }} onClick={onDone}>
        完了
      </button>
    </div>
  )
}

export default Toolbar
