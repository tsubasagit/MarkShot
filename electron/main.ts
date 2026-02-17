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
import {
  authenticateGoogle,
  uploadToGoogleDrive,
  isAuthenticated,
  clearAuth,
} from './google-drive'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
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
    show: true,
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
      // Request renderer to auto-save, then hide
      mainWindow?.webContents.send('auto-save-request')
      // Fallback: hide the window after 3 seconds even if auto-save doesn't respond
      setTimeout(() => {
        mainWindow?.hide()
      }, 3000)
    }
  })
}

function createOverlayWindow() {
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
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  overlayWindow.setIgnoreMouseEvents(false)

  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}#/capture`
    : `file://${path.join(DIST, 'index.html')}#/capture`

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

async function startCapture() {
  console.log('[startCapture] called')
  try {
    mainWindow?.hide()
    await new Promise((r) => setTimeout(r, 300))

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

      createOverlayWindow()
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

  setTimeout(() => {
    if (pendingEditorImage) {
      mainWindow?.webContents.send('editor:open', pendingEditorImage)
    }
  }, 300)
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

// ---- IPC: Auto-save ----

ipcMain.handle(
  'image:auto-save',
  async (_event, dataUrl: string): Promise<string | null> => {
    try {
      const folder = getLocalSaveFolder()
      const fileName = `snap_${generateTimestamp()}.png`
      const filePath = path.join(folder, fileName)

      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'))
      return filePath
    } catch (err) {
      console.error('Auto-save failed:', err)
      return null
    }
  }
)

ipcMain.on('auto-save-complete', () => {
  mainWindow?.hide()
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
    fs.writeFileSync(filePath, Buffer.from(data))
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
    fs.writeFileSync(filePath, Buffer.from(data))
    return filePath
  }
)

// ---- IPC: Google Drive ----

ipcMain.handle('google-drive:authenticate', async () => {
  return await authenticateGoogle()
})

ipcMain.handle('google-drive:upload', async (_event, dataUrl: string) => {
  return await uploadToGoogleDrive(dataUrl)
})

ipcMain.handle('google-drive:is-authenticated', () => {
  return isAuthenticated()
})

ipcMain.handle('google-drive:clear-auth', () => {
  clearAuth()
  return true
})

// ---- IPC: Settings ----

ipcMain.handle('settings:get', () => {
  const settings = loadSettings()
  // Don't send tokens to renderer
  return {
    localSavePath: settings.localSavePath,
    googleDrive: {
      clientId: settings.googleDrive.clientId,
      clientSecret: settings.googleDrive.clientSecret,
      folderName: settings.googleDrive.folderName,
      isAuthenticated: !!settings.googleDrive.refreshToken,
    },
  }
})

ipcMain.handle(
  'settings:update',
  async (
    _event,
    updates: {
      localSavePath?: string
      googleDrive?: {
        clientId?: string
        clientSecret?: string
        folderName?: string
      }
    }
  ) => {
    const settings = loadSettings()
    if (updates.localSavePath !== undefined) {
      settings.localSavePath = updates.localSavePath
    }
    if (updates.googleDrive) {
      if (updates.googleDrive.clientId !== undefined) {
        settings.googleDrive.clientId = updates.googleDrive.clientId
      }
      if (updates.googleDrive.clientSecret !== undefined) {
        settings.googleDrive.clientSecret = updates.googleDrive.clientSecret
      }
      if (updates.googleDrive.folderName !== undefined) {
        settings.googleDrive.folderName = updates.googleDrive.folderName
      }
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
