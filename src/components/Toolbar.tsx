import React from 'react'
import type { ToolType } from '../hooks/useAnnotation'

interface ToolbarProps {
  tool: ToolType
  onToolChange: (t: ToolType) => void
  onUndo: () => void
  canUndo: boolean
  onDone: () => void
  onCancel: () => void
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: '#1a1a2e',
    borderRadius: 8,
    border: '1px solid #2a2a4a',
    width: '100%',
    boxSizing: 'border-box',
  },
  btn: {
    padding: '6px 12px',
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
  spacer: { flex: 1 },
  primary: {
    background: '#00FFFF',
    color: '#0f0f1a',
    borderColor: '#00FFFF',
  },
  ghost: {
    background: 'transparent',
    color: '#b0b0d0',
    borderColor: '#2a2a4a',
  },
}

const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  onToolChange,
  onUndo,
  canUndo,
  onDone,
  onCancel,
}) => {
  return (
    <div style={styles.bar}>
      <button
        style={{ ...styles.btn, ...(tool === 'select' ? styles.active : null) }}
        onClick={() => onToolChange('select')}
      >
        選択
      </button>
      <button
        style={{ ...styles.btn, ...(tool === 'arrow' ? styles.active : null) }}
        onClick={() => onToolChange('arrow')}
      >
        矢印
      </button>
      <button
        style={{ ...styles.btn, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'default' }}
        onClick={onUndo}
        disabled={!canUndo}
      >
        ↶ 戻る
      </button>
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
