import React from 'react'
import { openSaveDir } from '../utils/settings'

interface OpenSaveDirButtonProps {
  style?: React.CSSProperties
}

/**
 * 現在の保存先フォルダをエクスプローラーで開くフォルダアイコンのボタン。
 * メイン画面と編集画面のツールバーで共通表示する。
 */
const OpenSaveDirButton: React.FC<OpenSaveDirButtonProps> = ({ style }) => {
  const handleClick = async () => {
    try {
      await openSaveDir()
    } catch (e) {
      console.error('open_save_dir failed', e)
      window.alert(`保存先フォルダを開けませんでした。設定の保存先フォルダをご確認ください。\n${e}`)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title="保存先フォルダを開く"
      aria-label="保存先フォルダを開く"
      style={style}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  )
}

export default OpenSaveDirButton
