/**
 * 保存先パスをコピーするショートカット（C 単体 / Ctrl+C）か判定する。
 * テキスト入力中や、画面上の文字を選択している時の Ctrl+C は通常のコピーに譲る。
 */
export function isCopyPathShortcut(e: KeyboardEvent): boolean {
  if (e.repeat || e.isComposing) return false
  const target = e.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return false
  }
  const key = e.key.toLowerCase()
  const plainC = key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
  const ctrlC = key === 'c' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
  if (ctrlC) {
    const selection = window.getSelection()?.toString() ?? ''
    if (selection.length > 0) return false
  }
  return plainC || ctrlC
}
