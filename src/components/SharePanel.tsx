import React, { useState } from 'react'
import SettingsPanel from './SettingsPanel'
import { copyImageToClipboard, copyTextToClipboard } from '../utils/clipboard'

interface SharePanelProps {
  onExportImage: () => string | null
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: '#1a1a2e',
    borderRadius: 8,
    border: '1px solid #2a2a4a',
  },
  btn: {
    padding: '8px 18px',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.15s',
    fontFamily: 'Segoe UI, Meiryo, sans-serif',
    fontWeight: 600,
  },
  driveBtn: {
    background: '#4285f4',
    color: '#fff',
  },
  copyBtn: {
    background: '#2a2a4a',
    color: '#b0b0d0',
  },
  settingsBtn: {
    background: '#2a2a4a',
    color: '#b0b0d0',
    padding: '8px 12px',
  },
  status: {
    fontSize: 12,
    padding: '2px 8px',
    maxWidth: 350,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
}

const SharePanel: React.FC<SharePanelProps> = ({ onExportImage }) => {
  const [status, setStatus] = useState<string | null>(null)
  const [driveUrl, setDriveUrl] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const showStatus = (msg: string, error = false, url?: string) => {
    setStatus(msg)
    setIsError(error)
    setDriveUrl(url ?? null)
    setTimeout(() => {
      setStatus(null)
      setDriveUrl(null)
    }, 8000)
  }

  const handleDriveSave = async () => {
    const dataUrl = onExportImage()
    if (!dataUrl) return

    setUploading(true)
    try {
      // Check if authenticated
      const isAuth = await window.electronAPI?.isGoogleAuthenticated()

      if (!isAuth) {
        // Try to authenticate first
        try {
          await window.electronAPI?.authenticateGoogle()
        } catch (authErr: any) {
          showStatus(`認証エラー: ${authErr.message}`, true)
          setUploading(false)
          return
        }
      }

      // Upload to Google Drive
      const result = await window.electronAPI?.uploadToGoogleDrive(dataUrl)
      if (result) {
        copyTextToClipboard(result.webViewLink)
        showStatus('Google Drive に保存 — URLをコピー済み', false, result.webViewLink)
      }
    } catch (err: any) {
      showStatus(`保存失敗: ${err.message}`, true)
    } finally {
      setUploading(false)
    }
  }

  const handleCopyImage = () => {
    const dataUrl = onExportImage()
    if (!dataUrl) return
    copyImageToClipboard(dataUrl)
    showStatus('クリップボードにコピーしました')
  }

  return (
    <>
      <div style={styles.panel}>
        <button
          style={{ ...styles.btn, ...styles.copyBtn }}
          onClick={handleCopyImage}
          title="画像をクリップボードにコピー"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          コピー
        </button>

        <button
          style={{ ...styles.btn, ...styles.driveBtn }}
          onClick={handleDriveSave}
          disabled={uploading}
          title="Google Drive に保存"
        >
          {uploading ? '保存中...' : 'GoogleDriveSave'}
        </button>

        <button
          style={{ ...styles.btn, ...styles.settingsBtn }}
          onClick={() => setShowSettings(true)}
          title="設定"
        >
          ⚙
        </button>

        {status && (
          <span
            style={{
              ...styles.status,
              color: isError ? '#FF0055' : '#39FF14',
            }}
          >
            {status}
            {driveUrl && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  copyTextToClipboard(driveUrl)
                }}
                style={{
                  color: '#4285f4',
                  marginLeft: 6,
                  fontSize: 11,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
                title={driveUrl}
              >
                URLを再コピー
              </a>
            )}
          </span>
        )}
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  )
}

export default SharePanel
