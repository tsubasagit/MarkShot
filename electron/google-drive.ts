import { shell } from 'electron'
import http from 'http'
import crypto from 'crypto'
import { loadSettings, saveSettings } from './settings'

// Google OAuth 2.0 PKCE flow for desktop apps
// Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const SCOPES = 'https://www.googleapis.com/auth/drive.file'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Start OAuth PKCE flow:
 * 1. Generate PKCE code verifier/challenge
 * 2. Start local HTTP server to receive callback
 * 3. Open browser for Google login
 * 4. Exchange authorization code for tokens
 * 5. Save tokens to settings
 */
export function startOAuthFlow(): Promise<void> {
  return new Promise((resolve, reject) => {
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    const server = http.createServer()

    // Find a random available port
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to start local server'))
        return
      }

      const port = address.port
      const redirectUri = `http://127.0.0.1:${port}`

      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
      })

      const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        server.close()
        reject(new Error('認証がタイムアウトしました'))
      }, 5 * 60 * 1000)

      server.on('request', async (req, res) => {
        try {
          const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<html><body><h2>認証がキャンセルされました。このタブを閉じてください。</h2></body></html>')
            clearTimeout(timeout)
            server.close()
            reject(new Error(`認証エラー: ${error}`))
            return
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<html><body><h2>認証コードが見つかりません。</h2></body></html>')
            return
          }

          // Exchange code for tokens
          const tokenResponse = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              client_secret: CLIENT_SECRET,
              code,
              code_verifier: codeVerifier,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }).toString(),
          })

          if (!tokenResponse.ok) {
            const errText = await tokenResponse.text()
            throw new Error(`トークン取得失敗: ${errText}`)
          }

          const tokens = await tokenResponse.json()

          // Save tokens
          const settings = loadSettings()
          settings.googleAccessToken = tokens.access_token
          settings.googleRefreshToken = tokens.refresh_token || settings.googleRefreshToken
          settings.googleTokenExpiry = Date.now() + tokens.expires_in * 1000
          saveSettings(settings)

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>MarkShot に接続しました！</h2><p>このタブを閉じてアプリに戻ってください。</p></body></html>')

          clearTimeout(timeout)
          server.close()
          resolve()
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<html><body><h2>エラーが発生しました。</h2></body></html>')
          clearTimeout(timeout)
          server.close()
          reject(err)
        }
      })

      // Open browser
      shell.openExternal(authUrl)
    })

    server.on('error', (err) => {
      reject(new Error(`ローカルサーバー起動失敗: ${err.message}`))
    })
  })
}

/**
 * Get a valid access token, refreshing if expired
 */
async function getValidAccessToken(): Promise<string> {
  const settings = loadSettings()

  if (!settings.googleRefreshToken) {
    throw new Error('Googleに接続されていません。設定画面からログインしてください。')
  }

  // Return existing token if still valid (with 60s buffer)
  if (settings.googleAccessToken && settings.googleTokenExpiry > Date.now() + 60_000) {
    return settings.googleAccessToken
  }

  // Refresh the token
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: settings.googleRefreshToken,
    }).toString(),
  })

  if (!response.ok) {
    const errText = await response.text()
    // If refresh token is revoked, clear tokens
    if (response.status === 400 || response.status === 401) {
      settings.googleAccessToken = ''
      settings.googleRefreshToken = ''
      settings.googleTokenExpiry = 0
      saveSettings(settings)
      throw new Error('Googleの認証が無効です。再度ログインしてください。')
    }
    throw new Error(`トークン更新失敗: ${errText}`)
  }

  const tokens = await response.json()
  settings.googleAccessToken = tokens.access_token
  settings.googleTokenExpiry = Date.now() + tokens.expires_in * 1000
  if (tokens.refresh_token) {
    settings.googleRefreshToken = tokens.refresh_token
  }
  saveSettings(settings)

  return tokens.access_token
}

/**
 * Upload image to Google Drive using multipart upload API
 */
export async function uploadToGoogleDrive(
  dataUrl: string
): Promise<{ fileUrl: string }> {
  const accessToken = await getValidAccessToken()
  const settings = loadSettings()

  // Detect file type from data URL
  const isGif = dataUrl.startsWith('data:image/gif')
  const mimeType = isGif ? 'image/gif' : 'image/png'
  const ext = isGif ? 'gif' : 'png'

  // Generate filename
  const now = new Date()
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const fileName = `${isGif ? 'gif' : 'snap'}_${ts}.${ext}`

  // Prepare file content
  const base64Data = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '')

  // Multipart upload metadata
  const metadata: Record<string, unknown> = { name: fileName }
  if (settings.driveFolderId) {
    metadata.parents = [settings.driveFolderId]
  }

  const boundary = `markshot_${crypto.randomBytes(16).toString('hex')}`
  const metadataStr = JSON.stringify(metadata)

  // Build multipart body
  const bodyParts = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    metadataStr,
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${mimeType}\r\n`,
    'Content-Transfer-Encoding: base64\r\n\r\n',
    base64Data,
    `\r\n--${boundary}--`,
  ]

  const body = Buffer.concat(bodyParts.map(p => Buffer.from(p, 'utf-8')))

  // Upload to Drive API
  const uploadResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text()
    throw new Error(`アップロード失敗: ${errText}`)
  }

  const file = await uploadResponse.json()

  // Set sharing permission: anyone with link can view
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    }
  )

  return { fileUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` }
}

/**
 * Clear stored tokens (logout)
 */
export function logoutGoogle(): void {
  const settings = loadSettings()
  settings.googleAccessToken = ''
  settings.googleRefreshToken = ''
  settings.googleTokenExpiry = 0
  saveSettings(settings)
}

/**
 * Check if Google account is connected
 */
export function isGoogleConnected(): boolean {
  const settings = loadSettings()
  return !!settings.googleRefreshToken
}
