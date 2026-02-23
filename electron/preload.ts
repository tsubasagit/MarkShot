import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Capture
  startCapture: () => {
    ipcRenderer.send('capture:start')
  },
  notifyOverlayReady: () => {
    ipcRenderer.send('capture:overlay-ready')
  },
  notifyScreenshotLoaded: () => {
    ipcRenderer.send('capture:screenshot-loaded')
  },
  onScreenshotData: (
    callback: (
      dataUrl: string,
      displayInfo: { width: number; height: number; scaleFactor: number }
    ) => void
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, dataUrl: string, displayInfo: { width: number; height: number; scaleFactor: number }) => {
      callback(dataUrl, displayInfo)
    }
    ipcRenderer.on('screenshot:data', handler)
    return () => {
      ipcRenderer.removeListener('screenshot:data', handler)
    }
  },
  sendRegionSelected: (regionDataUrl: string) => {
    ipcRenderer.send('capture:region-selected', regionDataUrl)
  },
  cancelCapture: () => {
    ipcRenderer.send('capture:cancel')
  },

  // Editor
  onEditorOpen: (callback: (imageDataUrl: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, imageDataUrl: string) => {
      callback(imageDataUrl)
    }
    ipcRenderer.on('editor:open', handler)
    return () => {
      ipcRenderer.removeListener('editor:open', handler)
    }
  },
  requestEditorImage: () => {
    ipcRenderer.send('editor:request-image')
  },

  // Auto-save
  autoSave: (dataUrl: string): Promise<string | null> => {
    return ipcRenderer.invoke('image:auto-save', dataUrl)
  },
  onAutoSaveRequest: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('auto-save-request', handler)
    return () => {
      ipcRenderer.removeListener('auto-save-request', handler)
    }
  },
  autoSaveComplete: () => {
    ipcRenderer.send('auto-save-complete')
  },

  // Window control
  hideWindow: () => {
    ipcRenderer.send('window:hide')
  },
  showWindow: () => {
    ipcRenderer.send('window:show')
  },

  // Image operations
  copyImage: (dataUrl: string) => {
    ipcRenderer.send('image:copy', dataUrl)
  },

  // GIF
  saveGif: (data: Uint8Array): Promise<string> => {
    return ipcRenderer.invoke('gif:save', data)
  },
  startGifCapture: () => {
    ipcRenderer.send('capture:start-gif')
  },
  sendGifRegion: (region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => {
    ipcRenderer.send('capture:gif-region-selected', region)
  },
  onGifRegionReady: (
    callback: (region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      region: { x: number; y: number; w: number; h: number; scaleFactor: number }
    ) => {
      callback(region)
    }
    ipcRenderer.on('gif:start-with-region', handler)
    return () => {
      ipcRenderer.removeListener('gif:start-with-region', handler)
    }
  },

  // Recording UI
  showRecordingUI: (region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => {
    ipcRenderer.send('gif:show-recording-ui', region)
  },
  hideRecordingUI: () => {
    ipcRenderer.send('gif:hide-recording-ui')
  },
  stopRecordingFromControl: () => {
    ipcRenderer.send('gif:stop-from-control')
  },
  onGifStopRecording: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('gif:stop-recording', handler)
    return () => {
      ipcRenderer.removeListener('gif:stop-recording', handler)
    }
  },

  // GIF Countdown
  showGifCountdown: () => {
    ipcRenderer.send('gif:show-countdown')
  },
  tickGifCountdown: (n: number) => {
    ipcRenderer.send('gif:countdown-tick', n)
  },
  hideGifCountdown: () => {
    ipcRenderer.send('gif:hide-countdown')
  },
  onCountdownTick: (callback: (n: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, n: number) => {
      callback(n)
    }
    ipcRenderer.on('countdown:tick', handler)
    return () => {
      ipcRenderer.removeListener('countdown:tick', handler)
    }
  },

  // Recording state
  notifyRecordingStarted: () => {
    ipcRenderer.send('gif:recording-started')
  },
  notifyRecordingStopped: () => {
    ipcRenderer.send('gif:recording-stopped')
  },

  // Google Drive
  uploadToGoogleDrive: (
    dataUrl: string
  ): Promise<{ fileUrl: string }> => {
    return ipcRenderer.invoke('google-drive:upload', dataUrl)
  },
  googleLogin: (): Promise<boolean> => {
    return ipcRenderer.invoke('google:login')
  },
  googleLogout: (): Promise<boolean> => {
    return ipcRenderer.invoke('google:logout')
  },
  googleStatus: (): Promise<boolean> => {
    return ipcRenderer.invoke('google:status')
  },

  // Settings
  getSettings: (): Promise<{
    localSavePath: string
    gasWebAppUrl: string
    gasFolderId: string
    driveFolderId: string
  }> => {
    return ipcRenderer.invoke('settings:get')
  },
  updateSettings: (
    updates: Record<string, unknown>
  ): Promise<boolean> => {
    return ipcRenderer.invoke('settings:update', updates)
  },
  browseFolder: (): Promise<string | null> => {
    return ipcRenderer.invoke('settings:browse-folder')
  },
})
