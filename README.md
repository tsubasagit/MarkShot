# MarkShot

Windows向けのスクリーンショット撮影・注釈・共有ツールです。

## 機能

### キャプチャ
- 画面の任意の領域を選択してキャプチャ
- 動画録画（WebM形式）
- GIF録画（最大30秒）
- スクロールキャプチャ（縦長ページの自動スクロール撮影）

### 注釈ツール
- ペン（フリーハンド描画）
- テキスト挿入
- 矢印
- 四角形・楕円
- モザイク（個人情報などのぼかし）
- ステップ番号（手順説明用の連番マーカー）
- バッジ（OK / NG / WARN / INFO / BUG）

### 保存・共有
- クリップボードにコピー
- ローカルフォルダへ自動保存
- Google Drive へアップロード

### システム連携
- システムトレイ常駐
- グローバルショートカット（Ctrl+Shift+S）
- トレイダブルクリックで即キャプチャ

## インストール

[Releases](https://github.com/tsubasagit/MarkShot/releases) から `MarkShot Setup x.x.x.exe` をダウンロードして実行してください。

## 開発

### 必要環境
- Node.js 18+
- npm

### セットアップ
```bash
git clone https://github.com/tsubasagit/MarkShot.git
cd MarkShot
npm install
```

### 開発サーバー起動
```bash
npm run dev
```

### ビルド（exe生成）
```bash
npm run build
```

`dist/MarkShot Setup 1.0.0.exe` が生成されます。

## 技術スタック

- Electron 28
- React 18
- TypeScript
- Konva（Canvas描画）
- Vite
- electron-builder（パッケージング）

## 作成者

宮崎翼
