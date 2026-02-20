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

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason)
})
process.on('exit', (code) => {
  console.error('[PROCESS] exit with code:', code)
})

let mainWindow: BrowserWindow | null = null
let overlayWindows: BrowserWindow[] = []
let overlayPool: Map<number, BrowserWindow> = new Map() // Reusable overlay windows by displayId
let recordingOverlayWindow: BrowserWindow | null = null
let recordingControlWindow: BrowserWindow | null = null
let tray: Tray | null = null
let activeDisplay: Electron.Display | null = null
let pendingScreenshots: Map<number, {
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
}> = new Map()
let overlayReadyWaitingCount = 0
let firstMinimizeNotified = false

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

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[MAIN WINDOW] render-process-gone:', details)
  })
  mainWindow.webContents.on('crashed' as any, () => {
    console.error('[MAIN WINDOW] renderer crashed')
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault()
      if (mainWindow.isVisible()) {
        mainWindow.webContents.send('auto-save-request')
        if (!firstMinimizeNotified && tray) {
          tray.displayBalloon({
            title: 'MarkShot',
            content: 'トレイに常駐しています。ダブルクリックでキャプチャ、右クリックでメニュー。',
            iconType: 'info',
          })
          firstMinimizeNotified = true
        }
      }
      mainWindow.hide()
    }
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
      win.hide()
    }
  })
  overlayWindows = []
  pendingScreenshots.clear()
  overlayReadyWaitingCount = 0
}

function getOrCreateOverlayWindow(display: Electron.Display, mode: 'screenshot' | 'gif' = 'screenshot'): BrowserWindow {
  const poolKey = display.id
  const existing = overlayPool.get(poolKey)

  if (existing && !existing.isDestroyed()) {
    if (mode === 'gif') {
      // GIF mode: destroy pooled window and create fresh to avoid GPU crash
      console.log('[getOrCreateOverlay] GIF mode: destroying pooled window for display', display.id)
      overlayPool.delete(poolKey)
      existing.destroy()
    } else {
      // Screenshot mode: reuse pooled window
      const hash = `#/capture?displayId=${display.id}`
      const url = process.env.VITE_DEV_SERVER_URL
        ? `${process.env.VITE_DEV_SERVER_URL}${hash}`
        : `file://${path.join(DIST, 'index.html')}${hash}`

      existing.hide()
      ;(existing as any).isReadyToReceive = false
      existing.loadURL(url)
      overlayWindows.push(existing)
      return existing
    }
  }

  // Create new window
  const { x, y, width, height } = display.bounds

  const win = new BrowserWindow({
    x,
    y,
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

  win.setIgnoreMouseEvents(false)

  const hash = mode === 'gif' ? `#/capture-gif?displayId=${display.id}` : `#/capture?displayId=${display.id}`
  const url = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}${hash}`
    : `file://${path.join(DIST, 'index.html')}${hash}`

  win.loadURL(url)
    ; (win as any).displayId = display.id

  win.on('closed', () => {
    overlayWindows = overlayWindows.filter(w => w !== win)
    overlayPool.delete(poolKey)
  })

  overlayPool.set(poolKey, win)
  overlayWindows.push(win)
  return win
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAA7EAAAOxAGVKw4bAAADI0lEQVR4nKWTXUyTVxjHjx8EmyXGYLwoK9Abo3GbLDHVWlQ0GiExw01SKmYzSvyYsY2auCyOifGTC43gWnAJlqmwbGCUjRlRqR1DCpa2kpYKbSldi7HtSyn9LvC2nL95q4wl3pjtSX435zz5nf9zkoeQ/13AnKVL8xcJBKuyOBYKBFmrtkuyhJ8fXTzLV4uFW99lzZpDGYT3UaEwTyILFR85HS86WB4tkZ2Nrdi2P5a9XhrL2bA7JsjjkM4ilsayxdJwzoZSLNu453uycPXOgoKyU/i6ooqWfXuZHqmoxpYvv4HwCxnWFcuxdpcM63bJICqWp+HORMXylEhyAsu37K0hJGfj9ipVEzweDx20D01b7Q467HRRxuelowxD/aMM5e6cLhd1j4xQl8tNfT5v0thvxceFZUpC+OsLfmxswUQ8km70ejyIhILo0BpwQXELlbWN6DMPIBELc4+kCY0HUhbrMFbPCGpv30M0HKLukZc0HBrHwz+7cbLyOiyDNuiem3H8nBIPNFowPl9aMDbmT5kHHfj034JIKJiO3NSqxsmLtbDaHelm599u9PUPoOKqClU3muD1ejEeGEv2Wx1vEwjyC5W37iEWDVOL1U7Lr9xAKBhAODiOw+VXsePAKbjcI+DqYk0DOp8ZkYhFkqbBGcESYUF9YwswGachxkcrlQ1obe+EzmgC97nnFTfR0a2HRqvHd5frYBsa5tIm/xkht+7u4dOaZ1M/2Zxxlc0ZeWx6kVKomlFdfwfVqmZcUN5G3S+tuFTTgB6DCQzDYMzvT5oGhjiBgnygMdRntOtG5z7QBshvnZabDlcAqclpdjLBvnrlYe0OJzvNJtjpqQQ7GY+ywWCAZSfiEzaHixtBQTLbehoz1L3I1BhAHut918z2qL7XjEddRvylM+Gpvh9qrRFq7XM86X6D1mhJtqh1yN1x8AfCa+/9ObPdwGY+MUwt6Ojzb/710fWVuZ8d4m8qPcYXl8j5ohK5QDwLP08qy86THM0RS06s2LTvE8L7/amId79rJ6+tq4jX1lPE+6Pvw5kl+0/LKWlunpeff2b++0AImfsaRsUyVZKqP74AAAAASUVORK5CYII='
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
  console.log('[startCapture] mode:', mode)
  try {
    console.log('[startCapture] step 1: closeAllOverlays')
    closeAllOverlays()

    console.log('[startCapture] step 2: getAllDisplays')
    const allDisplays = screen.getAllDisplays()
    overlayReadyWaitingCount = allDisplays.length
    console.log('[startCapture] displays:', allDisplays.length)

    console.log('[startCapture] step 3: creating overlay windows')
    for (const display of allDisplays) {
      console.log('[startCapture] creating overlay for display', display.id, 'pool has:', overlayPool.has(display.id))
      getOrCreateOverlayWindow(display, mode)
    }
    console.log('[startCapture] step 3 done')

    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      console.log('[startCapture] step 4: hiding mainWindow')
      mainWindow.hide()
      await new Promise((r) => setTimeout(r, 80))
    }

    // Use actual max display resolution instead of fixed 4000x4000
    const maxWidth = Math.max(...allDisplays.map(d => d.size.width * d.scaleFactor))
    const maxHeight = Math.max(...allDisplays.map(d => d.size.height * d.scaleFactor))
    console.log('[startCapture] step 5: desktopCapturer.getSources, size:', maxWidth, 'x', maxHeight)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: maxHeight }
    })
    console.log('[startCapture] step 5 done, sources:', sources.length)

    allDisplays.forEach(display => {
      const source = sources.find(s => s.display_id === String(display.id)) || sources[0]
      const { width, height } = display.size
      const scaleFactor = display.scaleFactor
      const screenshot = source.thumbnail.toDataURL()

      pendingScreenshots.set(display.id, { dataUrl: screenshot, width, height, scaleFactor })

      const win = overlayWindows.find(w => (w as any).displayId === display.id)
      if (win && !win.isDestroyed() && (win as any).isReadyToReceive) {
        win.webContents.send('screenshot:data', screenshot, { width, height, scaleFactor })
        win.show()
      }
    })
    console.log('[startCapture] done')

  } catch (err) {
    console.error('Failed to capture screen:', err)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
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
  const pending = pendingScreenshots.get(displayId)

  if (pending) {
    win.webContents.send('screenshot:data', pending.dataUrl, {
      width: pending.width,
      height: pending.height,
      scaleFactor: pending.scaleFactor,
    })
    win.show()
  } else {
    ; (win as any).isReadyToReceive = true
  }
})

ipcMain.on('capture:region-selected', (event, regionData: string) => {
  closeAllOverlays()

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
  }

  mainWindow!.setSize(1100, 750)
  mainWindow!.center()
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
  closeAllOverlays()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
})

// ---- IPC: GIF Capture (region selection) ----

ipcMain.on('capture:start-gif', () => {
  console.log('[IPC] capture:start-gif received')
  startCapture('gif')
})

ipcMain.on(
  'capture:gif-region-selected',
  (event, region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => {
    console.log('[IPC] capture:gif-region-selected, region:', region)
    const win = BrowserWindow.fromWebContents(event.sender)
    const displayId = win ? (win as any).displayId : undefined
    activeDisplay = displayId
      ? screen.getAllDisplays().find(d => d.id === displayId) || screen.getPrimaryDisplay()
      : screen.getPrimaryDisplay()

    closeAllOverlays()

    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('[GIF] mainWindow destroyed, recreating...')
      createMainWindow()
    }

    console.log('[GIF] showing mainWindow, isDestroyed:', mainWindow?.isDestroyed())
    mainWindow!.setSize(1100, 750)
    mainWindow!.center()
    mainWindow!.show()
    mainWindow!.focus()

    const sendRegion = () => {
      console.log('[GIF] sending gif:start-with-region to renderer')
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

ipcMain.handle(
  'image:auto-save',
  async (_event, dataUrl: string): Promise<string | null> => {
    try {
      const folder = getLocalSaveFolder()
      const fileName = `snap_${generateTimestamp()}.png`
      const filePath = path.join(folder, fileName)
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
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
    // Prevent app from quitting when all windows are hidden (e.g. during GIF capture)
    e.preventDefault()
  })

  app.on('child-process-gone', (_event, details) => {
    console.error('[APP] child-process-gone:', details)
  })

  app.on('render-process-gone' as any, (_event: any, _wc: any, details: any) => {
    console.error('[APP] render-process-gone:', details)
  })

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createTray()
    globalShortcut.register('Ctrl+Shift+S', () => {
      startCapture()
    })
    startCapture()
    // Defer main window creation — not needed until capture completes
    createMainWindow()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })
}
