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

## 関連ドキュメント

- 起動時間の詳細な分析：`docs/startup-analysis.md`
