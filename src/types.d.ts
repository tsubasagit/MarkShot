export {}

declare global {
  interface Window {
    electronAPI: {
      // Capture
      startCapture: () => void
      notifyOverlayReady: () => void
      notifyScreenshotLoaded: () => void
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

      // GIF
      saveGif: (data: Uint8Array) => Promise<string>
      startGifCapture: () => void
      sendGifRegion: (region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => void
      onGifRegionReady: (
        callback: (region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => void
      ) => () => void

      // Recording UI
      showRecordingUI: (region: { x: number; y: number; w: number; h: number; scaleFactor: number }) => void
      hideRecordingUI: () => void
      stopRecordingFromControl: () => void
      onGifStopRecording: (callback: () => void) => () => void

      // GIF Countdown
      showGifCountdown: () => void
      tickGifCountdown: (n: number) => void
      hideGifCountdown: () => void
      onCountdownTick: (callback: (n: number) => void) => () => void

      // Recording state
      notifyRecordingStarted: () => void
      notifyRecordingStopped: () => void

      // Google Drive
      uploadToGoogleDrive: (
        dataUrl: string
      ) => Promise<{ fileUrl: string }>
      googleLogin: () => Promise<boolean>
      googleLogout: () => Promise<boolean>
      googleStatus: () => Promise<boolean>

      // Settings
      getSettings: () => Promise<{
        localSavePath: string
        gasWebAppUrl: string
        gasFolderId: string
        driveFolderId: string
      }>
      updateSettings: (updates: Record<string, unknown>) => Promise<boolean>
      browseFolder: () => Promise<string | null>
    }
  }
}
