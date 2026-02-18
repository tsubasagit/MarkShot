import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
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

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let recordingOverlayWindow: BrowserWindow | null = null
let recordingControlWindow: BrowserWindow | null = null
let tray: Tray | null = null
let pendingScreenshot: {
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
} | null = null
let pendingEditorImage: string | null = null

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
    },
  })

  // Remove default menu bar
  Menu.setApplicationMenu(null)

  // Auto-select screen for getDisplayMedia (no picker dialog for video recording)
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (sources.length > 0) {
            callback({ video: sources[0] })
          }
        })
    }
  )

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(DIST, 'index.html'))
  }

  mainWindow.on('close', (e) => {
    if (mainWindow?.isVisible()) {
      e.preventDefault()
      // Optimization: Hide immediately for perceived speed
      mainWindow?.hide()
      // Request renderer to auto-save in background
      mainWindow?.webContents.send('auto-save-request')
    }
  })

  // Security: Block new windows/tabs from being created
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url)
    // Allow navigation only to local pages or dev server
    if (parsedUrl.origin !== 'file://' && !url.startsWith(process.env.VITE_DEV_SERVER_URL || '')) {
      event.preventDefault()
    }
  })
}

function createOverlayWindow(mode: 'screenshot' | 'gif' = 'screenshot') {
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size

  overlayWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreen: false,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  overlayWindow.setIgnoreMouseEvents(false)

  // ページ読み込み完了で即表示
  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.show()
  })

  const hash = mode === 'gif' ? '#/capture-gif' : '#/capture'
  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}${hash}`
    : `file://${path.join(DIST, 'index.html')}${hash}`

  overlayWindow.loadURL(url)

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAgElEQVQ4T2NkoBAwUqifYdAb8P///z8DAwODPQMDgz0+F/z//59hAQMDwwJ8BjAyMNj/Z2RcAJNjxGUIPBAmBjcERwBMjJGB0f4/E+MCRiYme0ZGRvv/TIwLGBkY7WFyYH4gTIyBkdH+PxPjAiCf0Z6BgcEeZgiyGC5XDHo3AADQ1C0RriBR4wAAAABJRU5ErkJggg=='
  )

  tray = new Tray(icon)
  tray.setToolTip('MarkShot')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'キャプチャ',
      click: () => startCapture(),
    },
    { type: 'separator' },
    {
      label: 'ウィンドウを表示',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: '終了',
      click: () => {
        mainWindow?.destroy()
        mainWindow = null
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => startCapture())
}

async function startCapture(mode: 'screenshot' | 'gif' = 'screenshot') {
  try {
    const wasVisible = mainWindow?.isVisible()
    if (wasVisible) {
      mainWindow?.hide()
      // ウィンドウが見えていた場合のみ短い待機（画面から消えるのを待つ）
      await new Promise((r) => setTimeout(r, 100))
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size
    const scaleFactor = primaryDisplay.scaleFactor

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.floor(width * scaleFactor),
        height: Math.floor(height * scaleFactor),
      },
    })

    if (sources.length > 0) {
      const screenshot = sources[0].thumbnail.toDataURL()

      pendingScreenshot = {
        dataUrl: screenshot,
        width,
        height,
        scaleFactor,
      }

      createOverlayWindow(mode)
    }
  } catch (err) {
    console.error('Failed to capture screen:', err)
    mainWindow?.show()
  }
}

// ---- IPC: Capture ----

ipcMain.on('capture:start', () => {
  startCapture()
})

ipcMain.on('capture:overlay-ready', () => {
  if (pendingScreenshot && overlayWindow) {
    overlayWindow.webContents.send(
      'screenshot:data',
      pendingScreenshot.dataUrl,
      {
        width: pendingScreenshot.width,
        height: pendingScreenshot.height,
        scaleFactor: pendingScreenshot.scaleFactor,
      }
    )
    pendingScreenshot = null
  }
})

ipcMain.on('capture:region-selected', (_event, regionData: string) => {
  overlayWindow?.close()
  overlayWindow = null

  if (!mainWindow) {
    createMainWindow()
  }

  pendingEditorImage = regionData

  mainWindow?.setSize(1100, 750)
  mainWindow?.center()
  mainWindow?.show()
  mainWindow?.focus()

  // ウィンドウ表示後にすぐ画像を送る（readyならすぐ、未readyなら待つ）
  const sendImage = () => {
    if (pendingEditorImage) {
      mainWindow?.webContents.send('editor:open', pendingEditorImage)
    }
  }
  if (mainWindow?.webContents.isLoading()) {
    mainWindow?.webContents.once('did-finish-load', sendImage)
  } else {
    sendImage()
  }
})

ipcMain.on('editor:request-image', () => {
  if (pendingEditorImage && mainWindow) {
    mainWindow.webContents.send('editor:open', pendingEditorImage)
    pendingEditorImage = null
  }
})

ipcMain.on('capture:cancel', () => {
  overlayWindow?.close()
  overlayWindow = null
  pendingScreenshot = null
  mainWindow?.show()
})

// ---- IPC: GIF Capture (region selection) ----

ipcMain.on('capture:start-gif', () => {
  startCapture('gif')
})

ipcMain.on(
  'capture:gif-region-selected',
  (_event, region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => {
    overlayWindow?.close()
    overlayWindow = null

    if (!mainWindow) {
      createMainWindow()
    }

    mainWindow?.setSize(1100, 750)
    mainWindow?.center()
    mainWindow?.show()
    mainWindow?.focus()

    const sendRegion = () => {
      mainWindow?.webContents.send('gif:start-with-region', region)
    }
    if (mainWindow?.webContents.isLoading()) {
      mainWindow?.webContents.once('did-finish-load', sendRegion)
    } else {
      sendRegion()
    }
  }
)

// ---- IPC: Recording UI (overlay + control popup) ----

ipcMain.on(
  'gif:show-recording-ui',
  (_event, region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenW, height: screenH } = primaryDisplay.size
    const sf = region.scaleFactor

    // Full-screen click-through overlay
    recordingOverlayWindow = new BrowserWindow({
      x: 0,
      y: 0,
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

    // Small control popup — position outside recording region
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
      x: controlX,
      y: controlY,
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
  recordingOverlayWindow?.close()
  recordingOverlayWindow = null
  recordingControlWindow?.close()
  recordingControlWindow = null
})

ipcMain.on('gif:stop-from-control', () => {
  mainWindow?.webContents.send('gif:stop-recording')
  recordingOverlayWindow?.close()
  recordingOverlayWindow = null
  recordingControlWindow?.close()
  recordingControlWindow = null
})

// ---- IPC: Auto-save ----

ipcMain.handle(
  'image:auto-save',
  async (_event, dataUrl: string): Promise<string | null> => {
    try {
      const folder = getLocalSaveFolder()
      const fileName = `snap_${generateTimestamp()}.png`
      const filePath = path.join(folder, fileName)

      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
      // Use async writing for better performance
      await fs.promises.writeFile(filePath, Buffer.from(base64Data, 'base64'))
      return filePath
    } catch (err) {
      console.error('Auto-save failed:', err)
      return null
    }
  }
)

ipcMain.on('auto-save-complete', () => {
  // Window is already hidden in 'close' event handler for speed
  // Just log or do nothing
})

// ---- IPC: Window control ----

ipcMain.on('window:hide', () => {
  mainWindow?.hide()
})

ipcMain.on('window:show', () => {
  mainWindow?.show()
  mainWindow?.focus()
})

// ---- IPC: Image copy (kept for Ctrl+C) ----

ipcMain.on('image:copy', (_event, dataUrl: string) => {
  const img = nativeImage.createFromDataURL(dataUrl)
  clipboard.writeImage(img)
})

// ---- IPC: Video save ----

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

// ---- IPC: GIF save ----

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

// ---- IPC: Google Drive (OAuth + Drive API) ----

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

// ---- IPC: Settings ----

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

// ---- App lifecycle ----

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createMainWindow()
    createTray()

    globalShortcut.register('Ctrl+Shift+S', () => {
      startCapture()
    })

    // 起動直後にキャプチャを開始（メインウィンドウのReact読み込みを待たない）
    startCapture()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    // Keep running in tray
  })

  app.on('activate', () => {
    if (!mainWindow) {
      createMainWindow()
    }
    mainWindow?.show()
  })
}
