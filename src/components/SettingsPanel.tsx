import React, { useState, useEffect } from 'react'

interface SettingsPanelProps {
  onClose: () => void
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  panel: {
    background: '#1a1a2e',
    borderRadius: 12,
    border: '1px solid #2a2a4a',
    padding: 24,
    width: 520,
    maxHeight: '80vh',
    overflow: 'auto',
    color: '#e0e0f0',
    fontFamily: 'Segoe UI, Meiryo, sans-serif',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: '#00FFFF',
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
    padding: 16,
    background: '#0f0f1a',
    borderRadius: 8,
    border: '1px solid #2a2a4a',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#b0b0d0',
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    color: '#6c7086',
    marginBottom: 4,
    display: 'block',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    background: '#1a1a2e',
    border: '1px solid #2a2a4a',
    borderRadius: 6,
    color: '#e0e0f0',
    fontSize: 13,
    fontFamily: 'monospace',
    outline: 'none',
    boxSizing: 'border-box' as const,
    marginBottom: 10,
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  btn: {
    padding: '7px 14px',
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'Segoe UI, Meiryo, sans-serif',
    fontWeight: 600,
    transition: 'opacity 0.15s',
  },
  primaryBtn: {
    background: '#00FFFF',
    color: '#0f0f1a',
  },
  secondaryBtn: {
    background: '#2a2a4a',
    color: '#b0b0d0',
  },
  hint: {
    fontSize: 11,
    color: '#555',
    lineHeight: 1.5,
    marginTop: 8,
  },
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const [localSavePath, setLocalSavePath] = useState('')
  const [driveFolderId, setDriveFolderId] = useState('')
  const [googleConnected, setGoogleConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [settings, connected] = await Promise.all([
        window.electronAPI.getSettings(),
        window.electronAPI.googleStatus(),
      ])
      setLocalSavePath(settings.localSavePath)
      setDriveFolderId(settings.driveFolderId)
      setGoogleConnected(connected)
    } catch {}
    setLoading(false)
  }

  const showMessage = (text: string, error = false) => {
    setMessage({ text, error })
    setTimeout(() => setMessage(null), 4000)
  }

  const handleBrowse = async () => {
    const path = await window.electronAPI.browseFolder()
    if (path) setLocalSavePath(path)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.electronAPI.updateSettings({
        localSavePath,
        driveFolderId,
      })
      showMessage('設定を保存しました')
    } catch (err: any) {
      showMessage(`保存失敗: ${err.message}`, true)
    }
    setSaving(false)
  }

  const handleGoogleLogin = async () => {
    setLoggingIn(true)
    try {
      await window.electronAPI.googleLogin()
      setGoogleConnected(true)
      showMessage('Googleアカウントに接続しました')
    } catch (err: any) {
      showMessage(`ログイン失敗: ${err.message}`, true)
    }
    setLoggingIn(false)
  }

  const handleGoogleLogout = async () => {
    await window.electronAPI.googleLogout()
    setGoogleConnected(false)
    showMessage('Googleアカウントから切断しました')
  }

  if (loading) return null

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={s.title}>設定</div>
          <button
            style={{ ...s.btn, ...s.secondaryBtn }}
            onClick={onClose}
          >
            閉じる
          </button>
        </div>

        {/* Local save path */}
        <div style={s.section}>
          <div style={s.sectionTitle}>ローカル保存先</div>
          <label style={s.label}>自動保存フォルダ</label>
          <div style={s.row}>
            <input
              style={{ ...s.input, flex: 1, marginBottom: 0 }}
              value={localSavePath}
              onChange={(e) => setLocalSavePath(e.target.value)}
            />
            <button
              style={{ ...s.btn, ...s.secondaryBtn }}
              onClick={handleBrowse}
            >
              参照
            </button>
          </div>
          <div style={s.hint}>
            新規スクショ時やウィンドウを閉じた時に、ここに自動保存されます。
          </div>
        </div>

        {/* Google Drive */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Google Drive</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            {googleConnected ? (
              <>
                <span style={{ fontSize: 13, color: '#39FF14' }}>
                  接続済み
                </span>
                <button
                  style={{ ...s.btn, ...s.secondaryBtn, fontSize: 11 }}
                  onClick={handleGoogleLogout}
                >
                  ログアウト
                </button>
              </>
            ) : (
              <button
                style={{ ...s.btn, ...s.primaryBtn }}
                onClick={handleGoogleLogin}
                disabled={loggingIn}
              >
                {loggingIn ? 'ブラウザで認証中...' : 'Googleでログイン'}
              </button>
            )}
          </div>

          <label style={s.label}>Google Drive フォルダID（任意）</label>
          <input
            style={s.input}
            value={driveFolderId}
            onChange={(e) => setDriveFolderId(e.target.value)}
            placeholder="フォルダURLの末尾のID（空欄ならマイドライブ直下）"
          />

          <div style={s.hint}>
            「Googleでログイン」を押すとブラウザが開きます。Googleアカウントで認証すると、スクリーンショットをGoogle Driveに直接アップロードできます。<br /><br />
            <strong style={{ color: '#8ab4c8' }}>フォルダIDの確認方法：</strong><br />
            Google Drive で保存先フォルダを開き、URLの末尾がフォルダIDです。<br />
            例: https://drive.google.com/drive/folders/<span style={{ color: '#00FFFF' }}>xxxxx</span> → 「xxxxx」の部分<br />
            空欄の場合はマイドライブ直下に保存されます。
          </div>
        </div>

        {/* Save button + message */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            style={{ ...s.btn, ...s.primaryBtn }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中...' : '設定を保存'}
          </button>
          {message && (
            <span
              style={{
                fontSize: 12,
                color: message.error ? '#FF0055' : '#39FF14',
              }}
            >
              {message.text}
            </span>
          )}
        </div>

        {/* About */}
        <div style={{ ...s.section, marginTop: 20, marginBottom: 0 }}>
          <div style={s.sectionTitle}>アプリ情報</div>
          <div style={{ fontSize: 13, color: '#b0b0d0', lineHeight: 1.8 }}>
            <div><span style={{ color: '#6c7086' }}>バージョン：</span>v1.3.0</div>
            <div><span style={{ color: '#6c7086' }}>作成者：</span>宮崎翼</div>
            <div>
              <span style={{ color: '#6c7086' }}>お問い合わせ：</span>
              <a
                href="https://share-na2.hsforms.com/2T1pQ6j2sQzajdd3AIDeWqgcy93d?utm_source=markshot"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#8ab4c8', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={(e) => {
                  e.preventDefault()
                  window.open('https://share-na2.hsforms.com/2T1pQ6j2sQzajdd3AIDeWqgcy93d?utm_source=markshot', '_blank')
                }}
              >
                お問い合わせフォーム
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
