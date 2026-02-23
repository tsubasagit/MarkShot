import React, { useState, useEffect } from 'react'

const CountdownOverlay: React.FC = () => {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const cleanup = window.electronAPI?.onCountdownTick((n: number) => {
      setCount(n)
    })
    return cleanup
  }, [])

  if (count === null) return null

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          fontSize: 120,
          fontWeight: 900,
          color: '#fff',
          textShadow: '0 0 40px rgba(255,145,0,0.8), 0 0 80px rgba(255,145,0,0.4)',
          fontFamily: 'monospace',
          animation: 'countdown-pop 0.5s ease-out',
        }}
        key={count}
      >
        {count}
      </div>
      <style>{`
        @keyframes countdown-pop {
          0% { transform: scale(1.5); opacity: 0.3; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

export default CountdownOverlay
