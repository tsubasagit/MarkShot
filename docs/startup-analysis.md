# MarkShot 起動時間の分析

## Windows Snipping Tool との違い

- **Snipping Tool**: ネイティブアプリ（軽量プロセス）、UI のみ即表示。
- **MarkShot**: Electron（Chromium + Node）＋ React ＋ Konva。起動時にまとめて JS を読み込むため、初回表示まで時間がかかる。

## 起動が遅い主な原因

### 1. **レンダラー側の初期バンドルが重い（最大の要因）**

- **現状**: `App.tsx` が以下を**すべて同期的に import** している。
  - `RegionSelector` … 範囲選択オーバーレイ
  - `AnnotationEditor` … **Konva / react-konva** を使用（バンドルが重い）
  - `RecordingOverlay`, `RecordingControl`, `CountdownOverlay`
- メインウィンドウを開くたびに、**Konva を含む全体**がパース・実行されるため、初回表示まで遅延する。
- **Konva** はキャンバス描画ライブラリでサイズが大きく、起動コストが高い。

### 2. **Electron の起動コスト**

- Chromium と Node の両方を立ち上げるため、ネイティブアプリよりどうしても遅い。
- これは「機能を落とす」だけではほとんど減らせない。

### 3. **開発時 (npm run dev) の追加コスト**

- Vite が初回アクセス時に React 等をコンパイルするため、本番ビルドよりさらに遅く感じる。
- 本番ビルド (`npm run build` 後の exe) は、事前ビルド済みなので開発時より速い。

### 4. **メインプロセス**

- `settings.ts` / `google-drive.ts` の import は軽い（同期的なファイル読みや HTTP のみ）。
- ウィンドウ作成前に重い処理はほぼない。主因はレンダラー側。

## 改善方針（機能を落とさずに速くする）

- **遅延読み込み (Lazy loading)** を入れる。
  - メインウィンドウの**初回表示**では Konva を使わない「軽い画面」だけを表示する。
  - スクリーンショットを撮ってエディタを開くタイミングで、`AnnotationEditor`（Konva）を読み込む。
- これで「起動〜メインウィンドウが表示されるまで」の時間を短くできる。
- キャプチャや GIF 録画など、既存機能は維持する。

## 実施する変更

- `AnnotationEditor` を `React.lazy` で読み込む。
- メインウィンドウで「画像がない状態」のときは Konva を読まず、軽いプレースホルダーを表示する。
- （任意）`RegionSelector` などほかの重いコンポーネントも lazy 化し、初回バンドルをさらに軽くする。
