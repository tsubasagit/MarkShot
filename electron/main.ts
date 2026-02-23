import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  clipboard,
  dialog,
  desktopCapturer,
} from 'electron'
import path from 'path'
import fs from 'fs'
import { loadSettings, saveSettings } from './settings'
import { uploadToGoogleDrive, startOAuthFlow, logoutGoogle, isGoogleConnected } from './google-drive'

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason)
})

let mainWindow: BrowserWindow | null = null
let overlayWindows: BrowserWindow[] = []
let overlayPool: Map<number, BrowserWindow> = new Map() // Reusable overlay windows by displayId
let recordingOverlayWindow: BrowserWindow | null = null
let recordingControlWindow: BrowserWindow | null = null
let countdownWindow: BrowserWindow | null = null
let activeDisplay: Electron.Display | null = null
let isRecording = false
let isCapturing = false
let pendingScreenshots: Map<number, {
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
}> = new Map()
let overlayReadyWaitingCount = 0

const DIST = path.join(__dirname, '../dist')
const PRELOAD = path.join(__dirname, 'preload.js')

function generateTimestamp(): string {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
}

function getLocalSaveFolder(): string {
  const settings = loadSettings()
  const folder = settings.localSavePath
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true })
  }
  return folder
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    frame: true,
    title: 'MarkShot',
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  Menu.setApplicationMenu(null)

  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (sources.length > 0) {
            const target = activeDisplay
              ? sources.find((s) => s.display_id === String(activeDisplay!.id)) || sources[0]
              : sources[0]
            callback({ video: target })
          } else {
            callback({})
          }
        })
        .catch((err) => {
          console.error('setDisplayMediaRequestHandler error:', err)
          callback({})
        })
    }
  )

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(DIST, 'index.html'))
  }

  mainWindow.on('close', (e) => {
    // GIF録画中・キャプチャ中は閉じない
    if (isRecording || isCapturing) {
      e.preventDefault()
      return
    }
    cleanupBeforeQuit()
    app.quit()
  })

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url)
    if (parsedUrl.origin !== 'file://' && !url.startsWith(process.env.VITE_DEV_SERVER_URL || '')) {
      event.preventDefault()
    }
  })
}

function closeAllOverlays() {
  overlayWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      if ((win as any)._overlayTimeout) {
        clearTimeout((win as any)._overlayTimeout)
        ;(win as any)._overlayTimeout = null
      }
      win.hide()
    }
  })
  overlayWindows = []
  pendingScreenshots.clear()
  overlayReadyWaitingCount = 0
}

function cleanupBeforeQuit() {
  closeAllOverlays()
  overlayPool.forEach(win => { if (win && !win.isDestroyed()) win.destroy() })
  overlayPool.clear()
  if (recordingOverlayWindow && !recordingOverlayWindow.isDestroyed()) { recordingOverlayWindow.destroy(); recordingOverlayWindow = null }
  if (recordingControlWindow && !recordingControlWindow.isDestroyed()) { recordingControlWindow.destroy(); recordingControlWindow = null }
  if (countdownWindow && !countdownWindow.isDestroyed()) { countdownWindow.destroy(); countdownWindow = null }
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.destroy(); mainWindow = null }
}

function getOrCreateOverlayWindow(display: Electron.Display, mode: 'screenshot' | 'gif' = 'screenshot'): BrowserWindow {
  const poolKey = display.id
  const existing = overlayPool.get(poolKey)

  if (existing && !existing.isDestroyed()) {
    overlayPool.delete(poolKey)
    existing.destroy()
  }

  // Create new window
  // Use bounds for position, but size for dimensions (bounds may differ with DPI scaling)
  const { x, y } = display.bounds
  const { width, height } = display.size

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreen: false,
    enableLargerThanScreen: true,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Force correct bounds — on mixed-DPI Windows setups, Electron may apply the
  // primary display's scale factor when creating a window on a secondary display,
  // resulting in a smaller-than-expected window.
  win.setBounds({ x, y, width, height })

  // Verify bounds after ready-to-show and correct if needed
  win.once('ready-to-show', () => {
    const current = win.getBounds()
    if (current.width !== width || current.height !== height || current.x !== x || current.y !== y) {
      win.setBounds({ x, y, width, height })
    }
  })

  win.setIgnoreMouseEvents(false)

  const hash = mode === 'gif' ? `#/capture-gif?displayId=${display.id}` : `#/capture?displayId=${display.id}`
  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}${hash}`
    : `file://${path.join(DIST, 'index.html')}${hash}`

  win.loadURL(url)
    ; (win as any).displayId = display.id

  // Timeout: if overlay-ready doesn't arrive within 5s, force show
  const timeoutId = setTimeout(() => {
    if (!(win as any).isReadyToReceive && !win.isDestroyed() && pendingScreenshots.has(display.id)) {
      const pending = pendingScreenshots.get(display.id)
      if (pending) {
        win.webContents.send('screenshot:data', pending.dataUrl, {
          width: pending.width,
          height: pending.height,
          scaleFactor: pending.scaleFactor,
        })
      }
      win.show()
    }
  }, 5000)
  ;(win as any)._overlayTimeout = timeoutId

  win.on('closed', () => {
    overlayWindows = overlayWindows.filter(w => w !== win)
    overlayPool.delete(poolKey)
  })

  overlayPool.set(poolKey, win)
  overlayWindows.push(win)
  return win
}

async function startCapture(mode: 'screenshot' | 'gif' = 'screenshot') {
  try {
    isCapturing = true
    closeAllOverlays()
    // キャプチャ前にメインウィンドウを非表示（hide()だけで十分。オフスクリーン移動はDWMのフレーム描画を壊す）
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.setSkipTaskbar(true)
      mainWindow.hide()
      await new Promise((r) => setTimeout(r, 500))
    }

    const allDisplays = screen.getAllDisplays()
    const maxWidth = Math.max(...allDisplays.map(d => d.size.width * d.scaleFactor))
    const maxHeight = Math.max(...allDisplays.map(d => d.size.height * d.scaleFactor))
    const capturerOpts = { types: ['screen'] as const, thumbnailSize: { width: maxWidth, height: maxHeight } }
    if (process.platform === 'win32') {
      await desktopCapturer.getSources(capturerOpts)
      await new Promise((r) => setTimeout(r, 500))
    }
    const sources = await desktopCapturer.getSources(capturerOpts)
    allDisplays.forEach(display => {
      const matched = sources.find(s => s.display_id === String(display.id))
      const source = matched || sources[0]
      const { width, height } = display.size
      const dataUrl = source.thumbnail.toDataURL()
      pendingScreenshots.set(display.id, { dataUrl, width, height, scaleFactor: display.scaleFactor })
    })

    overlayReadyWaitingCount = allDisplays.length
    // カーソルのあるディスプレイを最後に作成（フォーカスが最後の窓に行くため）
    const cursorPoint = screen.getCursorScreenPoint()
    const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint)
    const sortedDisplays = [...allDisplays].sort((a, b) => {
      if (a.id === cursorDisplay.id) return 1
      if (b.id === cursorDisplay.id) return -1
      return 0
    })
    for (const display of sortedDisplays) {
      getOrCreateOverlayWindow(display, mode)
    }
  } catch (err) {
    isCapturing = false
    console.error('Failed to capture screen:', err)
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSize(1100, 750)
      mainWindow.center()
      mainWindow.setSkipTaskbar(false)
      mainWindow.show()
    }
  }
}

// ---- IPC: Capture ----

ipcMain.on('capture:start', () => {
  startCapture()
})

ipcMain.on('capture:overlay-ready', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return

  const displayId = (win as any).displayId

  // Clear timeout since overlay is ready
  if ((win as any)._overlayTimeout) {
    clearTimeout((win as any)._overlayTimeout)
    ;(win as any)._overlayTimeout = null
  }

  const pending = pendingScreenshots.get(displayId)

  if (pending) {
    win.webContents.send('screenshot:data', pending.dataUrl, {
      width: pending.width,
      height: pending.height,
      scaleFactor: pending.scaleFactor,
    })
    // Show only after renderer has loaded the image (capture:screenshot-loaded)
  } else {
    ;(win as any).isReadyToReceive = true
  }
})

ipcMain.on('capture:screenshot-loaded', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    const displayId = (win as any).displayId
    win.show()
    // カーソルがあるディスプレイのオーバーレイにフォーカスを設定
    const cursorPoint = screen.getCursorScreenPoint()
    const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint)
    if (cursorDisplay.id === displayId) {
      win.focus()
      win.moveTop()
    }
  }
})

ipcMain.on('capture:region-selected', (event, regionData: string) => {
  isCapturing = false
  closeAllOverlays()

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
  }

  mainWindow!.setSize(1100, 750)
  mainWindow!.center()
  mainWindow!.setSkipTaskbar(false)
  mainWindow!.show()
  mainWindow!.focus()

  const sendImage = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('editor:open', regionData)
    }
  }
  if (mainWindow!.webContents.isLoading()) {
    mainWindow!.webContents.once('did-finish-load', sendImage)
  } else {
    sendImage()
  }
})

ipcMain.on('editor:request-image', () => {
})

ipcMain.on('capture:cancel', () => {
  isCapturing = false
  closeAllOverlays()
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(1100, 750)
    mainWindow.center()
    mainWindow.setSkipTaskbar(false)
    mainWindow.show()
  }
})

// ---- IPC: GIF Capture (region selection) ----

ipcMain.on('capture:start-gif', () => {
  startCapture('gif')
})

ipcMain.on(
  'capture:gif-region-selected',
  (event, region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => {
    isCapturing = false
    const win = BrowserWindow.fromWebContents(event.sender)
    const displayId = win ? (win as any).displayId : undefined
    activeDisplay = displayId
      ? screen.getAllDisplays().find(d => d.id === displayId) || screen.getPrimaryDisplay()
      : screen.getPrimaryDisplay()

    closeAllOverlays()

    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
    }

    mainWindow!.setSize(1100, 750)
    mainWindow!.center()
    mainWindow!.show()
    mainWindow!.focus()

    const sendRegion = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('gif:start-with-region', region)
      }
    }
    if (mainWindow!.webContents.isLoading()) {
      mainWindow!.webContents.once('did-finish-load', sendRegion)
    } else {
      sendRegion()
    }
  }
)

// ---- IPC: Recording UI (overlay + control popup) ----

ipcMain.on(
  'gif:show-recording-ui',
  (_event, region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => {
    const display = activeDisplay || screen.getPrimaryDisplay()
    const { width: screenW, height: screenH } = display.size
    const { x: dispX, y: dispY } = display.bounds
    const sf = region.scaleFactor

    recordingOverlayWindow = new BrowserWindow({
      x: dispX,
      y: dispY,
      width: screenW,
      height: screenH,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    recordingOverlayWindow.setIgnoreMouseEvents(true)

    const overlayHash = `#/recording-overlay/${region.x}/${region.y}/${region.w}/${region.h}/${region.scaleFactor}`
    const overlayUrl = process.env.VITE_DEV_SERVER_URL
      ? `${process.env.VITE_DEV_SERVER_URL}${overlayHash}`
      : `file://${path.join(DIST, 'index.html')}${overlayHash}`

    recordingOverlayWindow.loadURL(overlayUrl)
    recordingOverlayWindow.once('ready-to-show', () => {
      recordingOverlayWindow?.show()
    })
    recordingOverlayWindow.on('closed', () => {
      recordingOverlayWindow = null
    })

    const controlW = 200
    const controlH = 50
    const cssX = Math.round(region.x / sf)
    const cssY = Math.round(region.y / sf)
    const cssW = Math.round(region.w / sf)
    const cssH = Math.round(region.h / sf)

    let controlX = cssX
    let controlY = cssY + cssH + 10
    if (controlY + controlH > screenH) {
      controlY = cssY - controlH - 10
    }
    if (controlY < 0) {
      controlX = cssX + cssW + 10
      controlY = cssY
    }
    controlX = Math.max(0, Math.min(controlX, screenW - controlW))
    controlY = Math.max(0, Math.min(controlY, screenH - controlH))

    recordingControlWindow = new BrowserWindow({
      x: dispX + controlX,
      y: dispY + controlY,
      width: controlW,
      height: controlH,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const controlUrl = process.env.VITE_DEV_SERVER_URL
      ? `${process.env.VITE_DEV_SERVER_URL}#/recording-control`
      : `file://${path.join(DIST, 'index.html')}#/recording-control`

    recordingControlWindow.loadURL(controlUrl)
    recordingControlWindow.once('ready-to-show', () => {
      recordingControlWindow?.show()
    })
    recordingControlWindow.on('closed', () => {
      recordingControlWindow = null
    })
  }
)

ipcMain.on('gif:hide-recording-ui', () => {
  if (recordingOverlayWindow && !recordingOverlayWindow.isDestroyed()) {
    recordingOverlayWindow.close()
  }
  recordingOverlayWindow = null
  if (recordingControlWindow && !recordingControlWindow.isDestroyed()) {
    recordingControlWindow.close()
  }
  recordingControlWindow = null
})

ipcMain.on('gif:stop-from-control', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gif:stop-recording')
  }
  if (recordingOverlayWindow && !recordingOverlayWindow.isDestroyed()) {
    recordingOverlayWindow.close()
  }
  recordingOverlayWindow = null
  if (recordingControlWindow && !recordingControlWindow.isDestroyed()) {
    recordingControlWindow.close()
  }
  recordingControlWindow = null
})

// ---- IPC: GIF Countdown (separate window) ----

ipcMain.on('gif:show-countdown', () => {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    countdownWindow.close()
  }

  countdownWindow = new BrowserWindow({
    width: 200,
    height: 200,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const hash = '#/countdown'
  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}${hash}`
    : `file://${path.join(DIST, 'index.html')}${hash}`

  countdownWindow.loadURL(url)
  countdownWindow.once('ready-to-show', () => {
    countdownWindow?.show()
  })
  countdownWindow.on('closed', () => {
    countdownWindow = null
  })
})

ipcMain.on('gif:countdown-tick', (_event, n: number) => {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    countdownWindow.webContents.send('countdown:tick', n)
  }
})

ipcMain.on('gif:hide-countdown', () => {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    countdownWindow.close()
  }
  countdownWindow = null
})

// ---- IPC: Recording state ----

ipcMain.on('gif:recording-started', () => {
  isRecording = true
})

ipcMain.on('gif:recording-stopped', () => {
  isRecording = false
})

ipcMain.handle(
  'image:auto-save',
  async (_event, dataUrl: string): Promise<string | null> => {
    try {
      const folder = getLocalSaveFolder()
      // Detect MIME type to use correct file extension
      const mimeMatch = dataUrl.match(/^data:image\/(png|gif|jpeg|webp);base64,/)
      const imageType = mimeMatch ? mimeMatch[1] : 'png'
      const prefix = imageType === 'gif' ? 'gif' : 'snap'
      const ext = imageType === 'jpeg' ? 'jpg' : imageType
      const fileName = `${prefix}_${generateTimestamp()}.${ext}`
      const filePath = path.join(folder, fileName)
      // Generic regex to strip any image data URL prefix
      const base64Data = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '')
      await fs.promises.writeFile(filePath, Buffer.from(base64Data, 'base64'))
      return filePath
    } catch (err) {
      console.error('Auto-save failed:', err)
      return null
    }
  }
)

ipcMain.on('auto-save-complete', () => {
})

ipcMain.on('window:hide', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
})

ipcMain.on('window:show', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
})

ipcMain.on('image:copy', (_event, dataUrl: string) => {
  const img = nativeImage.createFromDataURL(dataUrl)
  clipboard.writeImage(img)
})

ipcMain.handle(
  'video:save',
  async (_event, data: Uint8Array): Promise<string> => {
    const folder = getLocalSaveFolder()
    const fileName = `video_${generateTimestamp()}.webm`
    const filePath = path.join(folder, fileName)
    await fs.promises.writeFile(filePath, Buffer.from(data))
    return filePath
  }
)

ipcMain.handle(
  'gif:save',
  async (_event, data: Uint8Array): Promise<string> => {
    const folder = getLocalSaveFolder()
    const fileName = `gif_${generateTimestamp()}.gif`
    const filePath = path.join(folder, fileName)
    await fs.promises.writeFile(filePath, Buffer.from(data))
    return filePath
  }
)

ipcMain.handle('google-drive:upload', async (_event, dataUrl: string) => {
  return await uploadToGoogleDrive(dataUrl)
})

ipcMain.handle('google:login', async () => {
  await startOAuthFlow()
  return true
})

ipcMain.handle('google:logout', () => {
  logoutGoogle()
  return true
})

ipcMain.handle('google:status', () => {
  return isGoogleConnected()
})

ipcMain.handle('settings:get', () => {
  return loadSettings()
})

ipcMain.handle(
  'settings:update',
  async (
    _event,
    updates: {
      localSavePath?: string
      gasWebAppUrl?: string
      gasFolderId?: string
      driveFolderId?: string
    }
  ) => {
    const settings = loadSettings()
    if (updates.localSavePath !== undefined) {
      settings.localSavePath = updates.localSavePath
    }
    if (updates.gasWebAppUrl !== undefined) {
      settings.gasWebAppUrl = updates.gasWebAppUrl
    }
    if (updates.gasFolderId !== undefined) {
      settings.gasFolderId = updates.gasFolderId
    }
    if (updates.driveFolderId !== undefined) {
      settings.driveFolderId = updates.driveFolderId
    }
    saveSettings(settings)
    return true
  }
)

ipcMain.handle('settings:browse-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: '保存先フォルダを選択',
    properties: ['openDirectory'],
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('window-all-closed', (e: Event) => {
    if (isRecording || isCapturing) {
      e.preventDefault()
      return
    }
    app.quit()
  })

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })
}
