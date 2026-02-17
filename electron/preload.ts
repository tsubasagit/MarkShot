import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Capture
  startCapture: () => {
    ipcRenderer.send('capture:start')
  },
  notifyOverlayReady: () => {
    ipcRenderer.send('capture:overlay-ready')
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

  // Video
  saveVideo: (data: Uint8Array): Promise<string> => {
    return ipcRenderer.invoke('video:save', data)
  },

  // GIF
  saveGif: (data: Uint8Array): Promise<string> => {
    return ipcRenderer.invoke('gif:save', data)
  },

  // Google Drive
  authenticateGoogle: (): Promise<boolean> => {
    return ipcRenderer.invoke('google-drive:authenticate')
  },
  uploadToGoogleDrive: (
    dataUrl: string
  ): Promise<{ fileId: string; webViewLink: string }> => {
    return ipcRenderer.invoke('google-drive:upload', dataUrl)
  },
  isGoogleAuthenticated: (): Promise<boolean> => {
    return ipcRenderer.invoke('google-drive:is-authenticated')
  },
  clearGoogleAuth: (): Promise<boolean> => {
    return ipcRenderer.invoke('google-drive:clear-auth')
  },

  // Settings
  getSettings: (): Promise<{
    localSavePath: string
    googleDrive: {
      clientId: string
      clientSecret: string
      folderName: string
      isAuthenticated: boolean
    }
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
