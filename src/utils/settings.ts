import { invoke } from '@tauri-apps/api/core'
import { load, type Store } from '@tauri-apps/plugin-store'

export type Settings = {
  shortcut: string
  autoSave: boolean
  saveDir: string | null
  copyToClipboard: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  shortcut: 'CommandOrControl+Shift+S',
  autoSave: false,
  saveDir: null,
  copyToClipboard: true,
}

const STORE_FILE = 'settings.json'

let storePromise: Promise<Store> | null = null

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, {
      autoSave: true,
      defaults: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    })
  }
  return storePromise
}

export async function loadSettings(): Promise<Settings> {
  const store = await getStore()
  const entries = await Promise.all(
    (Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>).map(async (key) => {
      const value = await store.get<Settings[typeof key]>(key)
      return [key, value ?? DEFAULT_SETTINGS[key]] as const
    }),
  )
  return Object.fromEntries(entries) as Settings
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const store = await getStore()
  await store.set(key, value)
}

/**
 * 保存先フォルダ（未設定なら Pictures/MarkShot）をエクスプローラーで開く。
 * saveDir を省略したときは保存済みの設定を読む。
 */
export async function openSaveDir(saveDir?: string | null): Promise<void> {
  const dir =
    saveDir === undefined ? (await loadSettings().catch(() => DEFAULT_SETTINGS)).saveDir : saveDir
  await invoke<string>('open_save_dir', { saveDir: dir })
}
