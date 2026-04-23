import React, { useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import {
  loadSettings,
  saveSetting,
  DEFAULT_SETTINGS,
  type Settings,
} from '../utils/settings'

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
    boxSizing: 'border-box',
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
    fontWeight: 600,
    background: '#2a2a4a',
    color: '#e0e0f0',
  },
  btnPrimary: {
    background: '#00FFFF',
    color: '#0f0f1a',
  },
  check: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    fontSize: 13,
    color: '#e0e0f0',
    cursor: 'pointer',
    userSelect: 'none',
    marginBottom: 8,
  },
  hint: {
    fontSize: 11,
    color: '#6c7086',
    lineHeight: 1.5,
    marginTop: -4,
    marginBottom: 10,
  },
  closeRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSettings()
      .then((loaded) => setSettings(loaded))
      .catch((e) => console.error('SettingsPanel loadSettings', e))
      .finally(() => setLoading(false))
  }, [])

  const update = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    try {
      await saveSetting(key, value)
    } catch (e) {
      console.error(`saveSetting ${String(key)} failed`, e)
    }
  }

  const pickSaveDir = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: '保存先フォルダを選択',
      defaultPath: settings.saveDir ?? undefined,
    })
    if (typeof selected === 'string') {
      update('saveDir', selected)
    }
  }

  if (loading) {
    return (
      <div style={s.overlay} onClick={onClose}>
        <div style={s.panel} onClick={(e) => e.stopPropagation()}>
          <div>読み込み中…</div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.panel}>
        <div style={s.title}>設定</div>

        <div style={s.section}>
          <div style={s.sectionTitle}>キャプチャ</div>

          <label style={s.label}>グローバルショートカット</label>
          <input
            style={s.input}
            value={settings.shortcut}
            onChange={(e) => setSettings((p) => ({ ...p, shortcut: e.target.value }))}
            onBlur={() => update('shortcut', settings.shortcut)}
            placeholder="CommandOrControl+Shift+S"
          />
          <div style={s.hint}>
            例: CommandOrControl+Shift+S / Alt+PrintScreen。変更はアプリ再起動後に反映されます。
          </div>

          <label style={s.check}>
            <input
              type="checkbox"
              checked={settings.copyToClipboard}
              onChange={(e) => update('copyToClipboard', e.target.checked)}
            />
            キャプチャ後にクリップボードへ PNG コピー
          </label>

          <label style={s.check}>
            <input
              type="checkbox"
              checked={settings.autoSave}
              onChange={(e) => update('autoSave', e.target.checked)}
            />
            キャプチャ後にファイル保存
          </label>

          {settings.autoSave && (
            <>
              <label style={s.label}>保存先フォルダ</label>
              <div style={s.row}>
                <input
                  style={{ ...s.input, marginBottom: 0, flex: 1 }}
                  readOnly
                  value={settings.saveDir ?? '（未設定 → Pictures/MarkShot/）'}
                />
                <button style={s.btn} onClick={pickSaveDir}>参照</button>
                {settings.saveDir && (
                  <button style={s.btn} onClick={() => update('saveDir', null)}>
                    既定に戻す
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div style={s.section}>
          <div style={s.sectionTitle}>アプリ情報</div>
          <div style={{ fontSize: 13, color: '#b0b0d0', lineHeight: 1.8 }}>
            <div><span style={{ color: '#6c7086' }}>バージョン：</span>v2.0.0</div>
            <div><span style={{ color: '#6c7086' }}>作成者：</span>宮崎翼</div>
            <div>
              <span style={{ color: '#6c7086' }}>お問い合わせ：</span>
              <a
                href="https://apptalenthub.co.jp"
                style={{ color: '#8ab4c8', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={(e) => {
                  e.preventDefault()
                  openExternal('https://apptalenthub.co.jp').catch((err) =>
                    console.error('openExternal failed', err),
                  )
                }}
              >
                AppTalentHub
              </a>
            </div>
          </div>
        </div>

        <div style={s.closeRow}>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
