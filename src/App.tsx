import React, { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut'
import { writeText as tauriWriteText } from '@tauri-apps/plugin-clipboard-manager'
import RegionSelector from './components/RegionSelector'
import RecordingOverlay from './components/RecordingOverlay'
import RecordingControl from './components/RecordingControl'
import CountdownOverlay from './components/CountdownOverlay'
import CaptureBar from './components/CaptureBar'
import SettingsPanel from './components/SettingsPanel'
import AnnotationEditor from './components/AnnotationEditor'
import { loadSettings, DEFAULT_SETTINGS } from './utils/settings'

type GifRegion = { x: number; y: number; w: number; h: number; scaleFactor: number }

const App: React.FC = () => {
  const [hash] = useState(() => window.location.hash)
  const [overlayParam] = useState(() => new URLSearchParams(window.location.search).get('overlay'))

  const isCapture = overlayParam === 'capture' || hash.startsWith('#/capture?') || hash === '#/capture'
  const isCaptureGif = overlayParam === 'capture-gif' || hash.startsWith('#/capture-gif?') || hash === '#/capture-gif'
  const isRecordingOverlay = hash.startsWith('#/recording-overlay/')
  const isRecordingControl = hash === '#/recording-control'
  const isCountdown = hash === '#/countdown'
  const isOverlay = isCapture || isCaptureGif || isRecordingOverlay || isRecordingControl || isCountdown

  useEffect(() => {
    document.body.className = isOverlay ? 'capture-mode' : 'editor-mode'
  }, [isOverlay])

  if (isCapture) {
    return <RegionSelector />
  }

  if (isCaptureGif) {
    return <RegionSelector mode="gif" />
  }

  if (isRecordingOverlay) {
    const parts = hash.replace('#/recording-overlay/', '').split('/')
    const region: GifRegion = {
      x: Number(parts[0]),
      y: Number(parts[1]),
      w: Number(parts[2]),
      h: Number(parts[3]),
      scaleFactor: Number(parts[4]),
    }
    return <RecordingOverlay region={region} />
  }

  if (isRecordingControl) {
    return <RecordingControl />
  }

  if (isCountdown) {
    return <CountdownOverlay />
  }

  return <Placeholder />
}

type CaptureCompletePayload = { dataUrl: string; savedPath: string | null }
type GifCompletePayload = { dataUrl: string; savedPath: string | null; filename: string }

function Placeholder() {
  const [captureMode, setCaptureMode] = useState<'screenshot' | 'gif'>('screenshot')
  const [captured, setCaptured] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pathCopied, setPathCopied] = useState(false)
  const [gifFilename, setGifFilename] = useState<string | null>(null)
  const [gifSaving, setGifSaving] = useState(false)

  const handleCopyPath = async () => {
    if (!savedPath) return
    try {
      // Tauri/WebView2 では navigator.clipboard.writeText がフォーカス/権限の都合で
      // 失敗することがあるため、Tauri プラグイン経由で書き込む。
      await tauriWriteText(savedPath)
      setPathCopied(true)
      setTimeout(() => setPathCopied(false), 1500)
    } catch (e) {
      console.error('copy path failed', e)
      try {
        await navigator.clipboard.writeText(savedPath)
        setPathCopied(true)
        setTimeout(() => setPathCopied(false), 1500)
      } catch (e2) {
        console.error('fallback navigator.clipboard failed', e2)
      }
    }
  }

  const handleSaveGif = async () => {
    if (!captured || gifSaving) return
    setGifSaving(true)
    try {
      const settings = await loadSettings().catch(() => DEFAULT_SETTINGS)
      let filename = gifFilename
      if (!filename) {
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        filename = `markshot_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.gif`
      }
      const path = await invoke<string>('save_gif', {
        dataUrl: captured,
        filename,
        saveDir: settings.saveDir,
      })
      setSavedPath(path)
    } catch (e) {
      console.error('save_gif failed', e)
      setError(`GIF保存エラー: ${String(e)}`)
    } finally {
      setGifSaving(false)
    }
  }

  useEffect(() => {
    let unlistenComplete: UnlistenFn | null = null
    let unlistenCancelled: UnlistenFn | null = null
    let unlistenGifComplete: UnlistenFn | null = null
    let unlistenGifError: UnlistenFn | null = null
    let registeredKey: string | null = null
    const setup = async () => {
      unlistenComplete = await listen<CaptureCompletePayload>('capture:complete', (e) => {
        setCaptured(e.payload.dataUrl)
        setSavedPath(e.payload.savedPath)
        setBusy(false)
        setError(null)
        setEditing(true)
      })
      unlistenCancelled = await listen('capture:cancelled', () => {
        setBusy(false)
      })
      // GIF 録画完了：エディタは開かず GIF をプレビュー表示する
      unlistenGifComplete = await listen<GifCompletePayload>('gif:complete', (e) => {
        setCaptured(e.payload.dataUrl)
        setSavedPath(e.payload.savedPath)
        setGifFilename(e.payload.filename)
        setBusy(false)
        setError(null)
        setEditing(false)
      })
      unlistenGifError = await listen<string>('gif:error', (e) => {
        setBusy(false)
        setError(`GIF録画エラー: ${e.payload}`)
      })
      const loaded = await loadSettings().catch((e) => {
        console.error('loadSettings failed', e)
        return DEFAULT_SETTINGS
      })
      try {
        if (await isRegistered(loaded.shortcut)) {
          await unregister(loaded.shortcut)
        }
        await register(loaded.shortcut, (event) => {
          if (event.state !== 'Pressed') return
          invoke('start_region_capture').catch((err) => console.error('shortcut invoke err', err))
        })
        registeredKey = loaded.shortcut
        console.log('[shortcut] JS registered', loaded.shortcut)
      } catch (e) {
        console.error('[shortcut] JS register failed', e)
      }
    }
    setup()
    return () => {
      unlistenComplete?.()
      unlistenCancelled?.()
      unlistenGifComplete?.()
      unlistenGifError?.()
      if (registeredKey) unregister(registeredKey).catch(() => {})
    }
  }, [])

  const saveEditedImage = async (
    editedDataUrl: string,
    options?: { forceSave?: boolean },
  ): Promise<string | null> => {
    const settings = await loadSettings().catch(() => DEFAULT_SETTINGS)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const filename = `markshot_edited_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`
    return await invoke<string | null>('save_annotated_image', {
      dataUrl: editedDataUrl,
      filename,
      autoSave: options?.forceSave ? true : settings.autoSave,
      saveDir: settings.saveDir,
      copyToClipboard: settings.copyToClipboard,
    })
  }

  const handleEditDone = async (editedDataUrl: string) => {
    try {
      await saveEditedImage(editedDataUrl)
      await getCurrentWindow().close()
    } catch (e) {
      console.error('save_annotated_image failed', e)
      setError(String(e))
      setEditing(false)
    }
  }

  const handleNewFromEditor = async (mode: 'screenshot' | 'gif', editedDataUrl: string) => {
    try {
      await saveEditedImage(editedDataUrl, { forceSave: true })
    } catch (e) {
      console.error('auto-save before new capture failed', e)
    }
    setEditing(false)
    setCaptured(null)
    setSavedPath(null)
    setError(null)
    setBusy(true)
    try {
      await invoke('start_region_capture', { mode })
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  const handleNewCapture = async (mode?: 'screenshot' | 'gif') => {
    const m = mode ?? captureMode
    setBusy(true)
    setError(null)
    try {
      await invoke('start_region_capture', { mode: m })
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  const isGif = !!captured && captured.startsWith('data:image/gif')

  if (editing && captured) {
    return (
      <AnnotationEditor
        imageDataUrl={captured}
        savedPath={savedPath}
        captureMode={captureMode}
        onCaptureModeChange={setCaptureMode}
        onDone={handleEditDone}
        onCancel={() => setEditing(false)}
        onNew={(mode, editedDataUrl) => handleNewFromEditor(mode, editedDataUrl)}
      />
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0f0f1a',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          width: '100%',
          justifyContent: 'center',
        }}
      >
        <CaptureBar
          captureMode={captureMode}
          onCaptureModeChange={setCaptureMode}
          onNewCapture={handleNewCapture}
          disabled={busy}
        />
        {captured && !isGif && (
          <button
            onClick={() => setEditing(true)}
            title="編集（矢印・テキスト・枠・ペン・モザイク）"
            style={{
              padding: '6px 14px',
              background: '#00FFFF',
              color: '#0f0f1a',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            編集
          </button>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          title="設定"
          style={{
            background: '#1a1a2e',
            border: '1px solid #2a2a4a',
            color: '#b0b0d0',
            borderRadius: 6,
            padding: '6px 10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 16,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {captured ? (
        <div
          style={{
            flex: 1,
            width: '100%',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            overflow: 'auto',
          }}
        >
          <img
            src={captured}
            alt="captured"
            style={{ maxWidth: '100%', maxHeight: '100%', border: '1px solid #2a2a4a', borderRadius: 4 }}
          />
          <div style={{ fontSize: 11, color: '#6c7086' }}>
            {isGif
              ? savedPath
                ? 'GIF録画を保存しました'
                : 'GIF録画が完了しました（未保存）'
              : 'クリップボードに PNG コピー済み（Ctrl+V で貼り付け可）'}
          </div>
          {isGif && !savedPath && (
            <button
              onClick={handleSaveGif}
              disabled={gifSaving}
              title="GIF をディスクに保存"
              style={{
                padding: '6px 16px',
                background: gifSaving ? '#2a2a4a' : '#00FFFF',
                color: gifSaving ? '#b0b0d0' : '#0f0f1a',
                border: 'none',
                borderRadius: 6,
                cursor: gifSaving ? 'default' : 'pointer',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {gifSaving ? '保存中…' : '保存'}
            </button>
          )}
          {savedPath && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                maxWidth: '90%',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#6c7086',
                  wordBreak: 'break-all',
                  textAlign: 'center',
                }}
              >
                保存先: {savedPath}
              </div>
              <button
                onClick={handleCopyPath}
                title="保存先パスをクリップボードにコピー"
                style={{
                  padding: '4px 10px',
                  background: pathCopied ? '#22c55e' : '#538bb0',
                  color: pathCopied ? '#0f0f1a' : '#ffffff',
                  border: '1px solid #2a2a4a',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {pathCopied ? 'コピー済み' : 'パスをコピー'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="empty-state" style={{ flex: 1 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4a4a6a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <h2>MarkShot</h2>
          <p>
            <strong>New</strong> ボタン / <strong>Ctrl+Shift+S</strong> で範囲選択開始<br />
            ドラッグで範囲指定 → クリップボードに PNG コピー<br />
            Esc / 右クリックでキャンセル
          </p>
          {busy && <p style={{ color: '#00FFFF' }}>オーバーレイ準備中…</p>}
          {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
        </div>
      )}
    </div>
  )
}

export default App
