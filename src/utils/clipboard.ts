/**
 * Copy image to clipboard via electron API
 */
export function copyImageToClipboard(dataUrl: string): void {
  window.electronAPI?.copyImage(dataUrl)
}

/**
 * Copy text to clipboard (for URLs, etc.)
 */
export function copyTextToClipboard(text: string): void {
  navigator.clipboard.writeText(text)
}
