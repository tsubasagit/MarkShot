import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export interface AppSettings {
  localSavePath: string
  gasWebAppUrl: string
  gasFolderId: string
  driveFolderId: string
  googleAccessToken: string
  googleRefreshToken: string
  googleTokenExpiry: number
}

let settingsPath = ''

function getSettingsPath(): string {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json')
  }
  return settingsPath
}

function getDefaultSettings(): AppSettings {
  return {
    localSavePath: path.join(app.getPath('desktop'), 'MarkShot'),
    gasWebAppUrl: '',
    gasFolderId: '',
    driveFolderId: '',
    googleAccessToken: '',
    googleRefreshToken: '',
    googleTokenExpiry: 0,
  }
}

export function loadSettings(): AppSettings {
  try {
    const p = getSettingsPath()
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
      const defaults = getDefaultSettings()
      return { ...defaults, ...data }
    }
  } catch {}
  return getDefaultSettings()
}

export function saveSettings(settings: AppSettings): void {
  const p = getSettingsPath()
  const dir = path.dirname(p)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(p, JSON.stringify(settings, null, 2))
}
