import { BrowserWindow } from 'electron'
import http from 'http'
import { loadSettings, saveSettings } from './settings'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const REDIRECT_PORT_START = 43210

function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.listen(start, '127.0.0.1', () => {
      server.close(() => resolve(start))
    })
    server.on('error', () => {
      findAvailablePort(start + 1).then(resolve)
    })
  })
}

export async function authenticateGoogle(): Promise<boolean> {
  const settings = loadSettings()
  const { clientId, clientSecret } = settings.googleDrive

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google API の Client ID と Client Secret を設定画面で入力してください。'
    )
  }

  const port = await findAvailablePort(REDIRECT_PORT_START)
  const redirectUri = `http://127.0.0.1:${port}/callback`

  return new Promise((resolve, reject) => {
    let authWindow: BrowserWindow | null = null
    let server: http.Server | null = null

    const cleanup = () => {
      authWindow?.close()
      authWindow = null
      server?.close()
      server = null
    }

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://127.0.0.1:${port}`)

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })

        if (error) {
          res.end(
            '<html><body style="background:#1a1a2e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div><h2>認証がキャンセルされました</h2><p>このウィンドウを閉じてください。</p></div></body></html>'
          )
          cleanup()
          reject(new Error('認証がキャンセルされました'))
          return
        }

        if (code) {
          try {
            const tokenResponse = await fetch(
              'https://oauth2.googleapis.com/token',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  code,
                  client_id: clientId,
                  client_secret: clientSecret,
                  redirect_uri: redirectUri,
                  grant_type: 'authorization_code',
                }),
              }
            )

            const tokens = await tokenResponse.json()

            if (tokens.error) {
              throw new Error(tokens.error_description || tokens.error)
            }

            settings.googleDrive.accessToken = tokens.access_token
            settings.googleDrive.refreshToken =
              tokens.refresh_token || settings.googleDrive.refreshToken
            settings.googleDrive.tokenExpiry =
              Date.now() + tokens.expires_in * 1000
            saveSettings(settings)

            res.end(
              '<html><body style="background:#1a1a2e;color:#39FF14;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div><h2>認証成功!</h2><p>このウィンドウを閉じてください。</p></div></body></html>'
            )
            cleanup()
            resolve(true)
          } catch (err: any) {
            res.end(
              `<html><body style="background:#1a1a2e;color:#FF0055;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div><h2>認証エラー</h2><p>${err.message}</p></div></body></html>`
            )
            cleanup()
            reject(err)
          }
        }
      }
    })

    server.listen(port, '127.0.0.1', () => {
      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
        `&access_type=offline` +
        `&prompt=consent`

      authWindow = new BrowserWindow({
        width: 500,
        height: 650,
        title: 'Google Drive 認証',
        autoHideMenuBar: true,
      })

      authWindow.loadURL(authUrl)
      authWindow.on('closed', () => {
        authWindow = null
        server?.close()
        server = null
      })
    })
  })
}

async function getValidAccessToken(): Promise<string> {
  const settings = loadSettings()

  if (!settings.googleDrive.refreshToken) {
    throw new Error('Google Drive に未認証です。設定画面から認証してください。')
  }

  // Return if token is still valid (with 5min buffer)
  if (
    settings.googleDrive.accessToken &&
    settings.googleDrive.tokenExpiry > Date.now() + 300000
  ) {
    return settings.googleDrive.accessToken
  }

  // Refresh the token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.googleDrive.clientId,
      client_secret: settings.googleDrive.clientSecret,
      refresh_token: settings.googleDrive.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const tokens = await response.json()

  if (tokens.error) {
    settings.googleDrive.refreshToken = ''
    settings.googleDrive.accessToken = ''
    saveSettings(settings)
    throw new Error('トークンが無効です。再認証してください。')
  }

  settings.googleDrive.accessToken = tokens.access_token
  settings.googleDrive.tokenExpiry = Date.now() + tokens.expires_in * 1000
  saveSettings(settings)

  return tokens.access_token
}

async function findOrCreateFolder(
  accessToken: string,
  folderName: string
): Promise<string> {
  const settings = loadSettings()

  // Check cached folder ID
  if (settings.googleDrive.folderId) {
    const checkRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${settings.googleDrive.folderId}?fields=id,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (checkRes.ok) {
      const data = await checkRes.json()
      if (!data.trashed) return settings.googleDrive.folderId
    }
  }

  // Search for existing folder
  const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const searchData = await searchRes.json()

  if (searchData.files && searchData.files.length > 0) {
    settings.googleDrive.folderId = searchData.files[0].id
    saveSettings(settings)
    return searchData.files[0].id
  }

  // Create folder
  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  )
  const createData = await createRes.json()

  settings.googleDrive.folderId = createData.id
  saveSettings(settings)
  return createData.id
}

export async function uploadToGoogleDrive(
  dataUrl: string
): Promise<{ fileId: string; webViewLink: string }> {
  const accessToken = await getValidAccessToken()
  const settings = loadSettings()
  const folderName = settings.googleDrive.folderName || 'MarkShot'
  const folderId = await findOrCreateFolder(accessToken, folderName)

  const now = new Date()
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const fileName = `snap_${ts}.png`

  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')

  const boundary = 'markshot_boundary_' + Date.now()
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
  })

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ])

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  )

  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    throw new Error(`アップロード失敗: ${errText}`)
  }

  return await uploadRes.json()
}

export function isAuthenticated(): boolean {
  const settings = loadSettings()
  return !!settings.googleDrive.refreshToken
}

export function clearAuth(): void {
  const settings = loadSettings()
  settings.googleDrive.refreshToken = ''
  settings.googleDrive.accessToken = ''
  settings.googleDrive.tokenExpiry = 0
  settings.googleDrive.folderId = ''
  saveSettings(settings)
}
