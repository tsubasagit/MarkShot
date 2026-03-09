# 修正メモ（コードが巻き戻った場合の参照用）

修正時に把握した「エラー・不具合の原因」をメモしておきます。同じ問題が再発したり、変更が戻ってしまったときに参照してください。

---

## 1. 連続スクリーンショットで選択枠が表示されない／1クリックで確定する

### 原因

- **プライマリモニターで2回目以降**：ドラッグ開始のしきい値がなく、クリックだけで「範囲確定」とみなされていた。
- **選択枠の描画**：React の state 更新の遅れや、rAF のタイミングで、キャンバス／DOM の枠が一瞬で消える・描画されないことがあった。
- **オーバーレイの前面**：複数ディスプレイで、操作しているオーバーレイが背面のままになり、rAF がスロットルされて枠が更新されないことがあった。

### 対応内容（戻さないこと）

- **`src/utils/regionSelectionLogic.ts`**  
  ドラッグ開始に `DRAG_START_THRESHOLD_PX`（5px）を導入。最小サイズ `MIN_SIZE_PX`（20px）未満は送信しない。
- **`RegionSelector.tsx`**  
  - 選択枠を「キャンバス＋DOM の div」の二重で描画（DOM は最小 2px で常に枠を表示）。  
  - ドラッグ中は `selectionStateRef` から直接描画し、state の遅れの影響を減らす。  
  - 新規スクリーンショット受信時に `forceHideFrameRef` で枠を即時非表示にし、次のドラッグで一貫して表示されるようにする。  
  - メイン側で `capture:overlay-focus` を用意し、マウスダウン時にそのオーバーレイを前面に出す（`bringOverlayToFront`）。  
- **main.ts**  
  オーバーレイ表示時に `win.moveTop()` を必ず実行し、表示順を固定。

---

## 2. 注釈エディタで「別のところをクリックしても選択が外れない」

### 原因

- Stage の `onMouseDown` で、空白や背景画像をクリックしたときに「選択解除」として扱っていなかった。

### 対応内容（戻さないこと）

- **`AnnotationEditor.tsx`**  
  `handleStageMouseDown` で、クリック先が Stage／Layer／注釈リストにないノードのときは `setSelectedId(null)` で選択解除する。

---

## 3. 起動が遅い（Windows Snipping Tool と比べて重い）

### 原因

- メインウィンドウの初回表示で、Konva／react-konva を含む `AnnotationEditor` を同期的に読み込んでおり、パース・実行に時間がかかっていた。

### 対応内容（戻さないこと）

- **`App.tsx`**  
  - `AnnotationEditor` を `React.lazy` で読み込み。  
  - 画像がないときは Konva を読まず、軽いプレースホルダー（「スクリーンショットはトレイアイコンから撮影できます」）のみ表示。  
  - スクリーンショット取得後にエディタを開くタイミングで初めてエディタ（Konva）を読み込む。

---

## 4. その他（テスト・ストレステスト）

- **`src/utils/regionSelectionLogic.ts`**  
  範囲選択の判定ロジックを純粋関数で抽出し、同じ入力で同じ結果になることをテストで保証。
- **`src/utils/regionSelectionLogic.test.ts`**  
  ドラッグ／クリックのみ／連続キャプチャ／最小サイズ／100 回バグチェックなどを Vitest で実施。
- **`package.json`**  
  `test:stress` でテストスイートを複数回実行し、安定性を確認。

---

## 5. GIF：切り取りが出ない／Save で保存されない

### 想定原因

- **切り取り後に録画が始まらない**：Placeholder 表示時は `AnnotationEditor` がマウントされず、`gif:start-with-region` を受け取るコンポーネントがなかった。
- **保存されない**：IPC で TypedArray が正しく届かない／保存先が無効／空 GIF を保存しようとしている。

### 対応内容（戻さないこと）

- **`App.tsx`**  
  - `onGifRegionReady` を App で購読。範囲受信時に `setPendingGifRegion(region)` し、`capturedImage` が null のときは `setCapturedImage(DUMMY_IMAGE)` でエディタをマウント。  
  - エディタに `initialGifRegion` と `onGifRegionConsumed` を渡す。
- **`AnnotationEditor.tsx`**  
  - `initialGifRegion` が渡ったら `startGifWithRegion(initialGifRegion)` を実行（Placeholder からでも録画開始）。  
  - `saveGif(Array.from(bytesArr))` で配列として送信（IPC のシリアライズを安定化）。  
  - バイト長 50 未満は保存せず「録画されたフレームがありません」と表示。  
  - IPC が失敗した場合は Blob のダウンロードでフォールバック（「GIFをダウンロードしました」）。
- **main.ts（gif:save）**  
  - `Uint8Array` / `number[]` / `ArrayBuffer` / array-like のいずれも Buffer 化して保存。  
  - 設定の保存先への書き込みに失敗したら `app.getPath('downloads')` に再試行。  
  - `getLocalSaveFolder()` は try/catch で userData/MarkShot にフォールバック。

---

## 6. GIF新規でプライマリ画面が真っ黒になる（Windows）

### 想定原因

- Windows で `desktopCapturer.getSources()` に複数ディスプレイの最大解像度をまとめて渡すと、プライマリのサムネイルが黒く返ることがある（Chromium/DWM の挙動）。

### 対応内容（戻さないこと）

- **main.ts（startCapture）**  
  - **Windows のみ**：全ディスプレイで 1 枚の大きい thumbnailSize で取るのをやめ、**ディスプレイごと**にその解像度の `thumbnailSize` で `getSources` を呼ぶ。  
  - 初回に 1x1 で一度 getSources して 300ms 待ってから、各 display の width/height で getSources し、その display 用の source だけ使って pendingScreenshots にセット。  
  - 2 台以上のときはディスプレイ間で 80ms ずつ待ってから次の getSources を実行。  
  - 他 OS は従来どおり 1 回の getSources（max 解像度）のまま。

---

## 関連ドキュメント

- 起動時間の詳細な分析：`docs/startup-analysis.md`
