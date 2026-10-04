import React from 'react'

/** 画面中央に一瞬だけ出すコピー完了の表示。クリックは下へ素通しする。 */
const CopiedToast: React.FC<{ show: boolean; message?: string }> = ({
  show,
  message = 'パスをコピーしました',
}) => (
  <div
    aria-live="polite"
    style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: `translate(-50%, -50%) scale(${show ? 1 : 0.96})`,
      opacity: show ? 1 : 0,
      transition: 'opacity 0.15s, transform 0.15s',
      pointerEvents: 'none',
      zIndex: 9999,
      padding: '12px 22px',
      background: 'rgba(15, 15, 26, 0.92)',
      border: '1px solid #22c55e',
      borderRadius: 8,
      color: '#ffffff',
      fontSize: 14,
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
    {message}
  </div>
)

export default CopiedToast
