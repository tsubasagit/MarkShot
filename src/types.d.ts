export {}

declare global {
  interface Window {
    electronAPI: {
      // Capture
      startCapture: () => void
      notifyOverlayReady: () => void
      onScreenshotData: (
        callback: (
          dataUrl: string,
          displayInfo: { width: number; height: number; scaleFactor: number }
        ) => void
      ) => () => void
      sendRegionSelected: (regionDataUrl: string) => void
      cancelCapture: () => void

      // Editor
      onEditorOpen: (callback: (imageDataUrl: string) => void) => () => void
      requestEditorImage: () => void

      // Auto-save
      autoSave: (dataUrl: string) => Promise<string | null>
      onAutoSaveRequest: (callback: () => void) => () => void
      autoSaveComplete: () => void

      // Window control
      hideWindow: () => void
      showWindow: () => void

      // Image operations
      copyImage: (dataUrl: string) => void

      // Video
      saveVideo: (data: Uint8Array) => Promise<string>

      // GIF
      saveGif: (data: Uint8Array) => Promise<string>

      // Google Drive
      authenticateGoogle: () => Promise<boolean>
      uploadToGoogleDrive: (
        dataUrl: string
      ) => Promise<{ fileId: string; webViewLink: string }>
      isGoogleAuthenticated: () => Promise<boolean>
      clearGoogleAuth: () => Promise<boolean>

      // Settings
      getSettings: () => Promise<{
        localSavePath: string
        googleDrive: {
          clientId: string
          clientSecret: string
          folderName: string
          isAuthenticated: boolean
        }
      }>
      updateSettings: (updates: Record<string, unknown>) => Promise<boolean>
      browseFolder: () => Promise<string | null>
    }
  }
}
