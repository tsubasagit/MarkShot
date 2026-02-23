# Electronアプリでプライマリディスプレイのスクリーンショットが取れない問題を解決した話

**MarkShot v1.3.0 開発記録**

`#Electron` `#Windows` `#TypeScript` `#HighDPI` `#MultiMonitor` `#BrowserWindow` `#desktopCapturer` `#ScreenCapture` `#WS_EX_LAYERED` `#transparent` `#debugging` `#ClaudeCode`

---

## はじめに

MarkShotはElectron製のスクリーンショット＆注釈ツールです。v1.2.2まで、**プライマリディスプレイでスクリーンショットが取れない**という致命的なバグを抱えていました。セカンドディスプレイでは動くのに、メインのディスプレイでドラッグしても反応しない。しかも「たまに動く」という再現性の低さが厄介でした。

この記事では、原因の特定から解決までに試した全アプローチと、最終的に何が効いたのかを記録します。

---

## 環境

- Windows 11 Home
- Electron 28.x
- プライマリディスプレイ: 1536x1024, **scaleFactor=1.5**（150% DPIスケーリング）
- セカンドディスプレイ: 1920x1080, scaleFactor=1.0（100%）

---

## 症状

1. 「New」ボタンでキャプチャ開始 → 全ディスプレイにオーバーレイが表示される
2. **プライマリディスプレイ上でドラッグしても範囲選択が始まらない**
3. クリックするとなぜかセカンドディスプレイのオーバーレイだけがアクティブになる
4. セカンドディスプレイでは正常に範囲選択・キャプチャできる
5. **稀に（10回に1回程度）プライマリでも成功する**

---

## 原因①: `mainWindow.destroy()` によるGPUプロセスの不安定化

### 問題のコード（v1.2.2）

```typescript
// electron/main.ts — startCapture()
if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
  mainWindow.destroy()   // ← これが元凶
  mainWindow = null
  await new Promise((r) => setTimeout(r, 1000))
}
```

これはキャプチャ時にエディタの残像が映り込む問題の回避策として導入されたコードでした。

### なぜダメだったのか

Electronの`BrowserWindow.destroy()`はウィンドウだけでなく、関連するレンダラープロセスとGPUリソースも解放します。**直後に新しいオーバーレイウィンドウを作成すると、GPUプロセスのパイプラインが不安定になり**、特にプライマリディスプレイ上のウィンドウが正しく描画・入力受付されないことがありました。

セカンドディスプレイで動作していたのは、ウィンドウ作成のタイミングがわずかにずれることで、GPUの再初期化が間に合っていたためと考えられます。

### デバッグ時のログ

```
[getOrCreateOverlay] display=2528732444 mode=screenshot bounds={"x":0,"y":0,"width":1536,"height":1024}
[getOrCreateOverlay] display=2779098405 mode=screenshot bounds={"x":1536,"y":0,"width":1920,"height":1080}
[Overlay] ready-to-show display=2528732444 currentBounds={"x":0,"y":0,"width":1536,"height":1024}
[Overlay] ready-to-show display=2779098405 currentBounds={"x":1536,"y":0,"width":1920,"height":1080}
[screenshot-loaded] showing overlay for display: 2528732444
[screenshot-loaded] focused overlay for cursor display: 2528732444
```

ログ上は全て正常。オーバーレイは作成され、表示され、フォーカスも設定されている。**しかしマウスイベントが来ない。** メインプロセスのログだけでは原因が見えず、レンダラー側の`mouseDown`ハンドラにもログを仕込んだが、**そもそもイベントが発火していなかった**。

### 修正

```typescript
// v1.3.0 — destroy()をやめて非表示+オフスクリーン移動
if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
  mainWindow.setSkipTaskbar(true)
  mainWindow.setOpacity(0)
  const b = mainWindow.getBounds()
  mainWindow.setBounds({ ...b, x: -b.width - 1000, y: -b.height - 1000 })
  mainWindow.hide()
  await new Promise((r) => setTimeout(r, 500))
}
```

ウィンドウを破棄せず、透明にして画面外に移動→非表示にする。GPUプロセスは安定したまま、残像も映らない。

---

## 原因②: `transparent: true` と Windows の WS_EX_LAYERED 問題

### 問題のコード（v1.2.2）

```typescript
const win = new BrowserWindow({
  x, y, width, height,
  transparent: true,    // ← これも問題
  frame: false,
  alwaysOnTop: true,
  // ...
})
```

### なぜダメだったのか

Electron（Chromium）でBrowserWindowに`transparent: true`を設定すると、Windows上では**WS_EX_LAYERED**ウィンドウスタイルが適用されます。このスタイルのウィンドウでは：

- **完全透明なピクセルに対するマウスイベントがOSレベルでスルーされる**
- 高DPI環境（scaleFactor≠1.0）ではピクセルの透明度判定が座標変換とずれることがある
- 結果として、**Canvas上に描画された半透明オーバーレイのマウスイベントが正しく届かない**

これが「たまに動く」という不安定な挙動の原因でした。DPIスケーリングの計算タイミングによって、ヒットテストの座標が合ったり合わなかったりしていたのです。

### 試行錯誤の記録

| アプローチ | 結果 |
|-----------|------|
| `setIgnoreMouseEvents(false)` を明示的に呼ぶ | 変化なし |
| `requestAnimationFrame` を2回ネストして描画完了を待つ | 改善せず |
| オーバーレイウィンドウの作成順序を変える | 改善せず |
| `win.focus()` + `win.moveTop()` を明示的に呼ぶ | 単体では不十分 |

### 修正

```typescript
const win = new BrowserWindow({
  x, y, width, height,
  transparent: false,         // ← 不透明に変更
  backgroundColor: '#000000', // ← 黒背景を設定
  frame: false,
  alwaysOnTop: true,
  // ...
})
```

`transparent: false`にすることでWS_EX_LAYEREDが適用されなくなり、マウスイベントが確実にウィンドウに届くようになりました。スクリーンショットのプレビューは黒背景の上にCanvasで描画するため、見た目の影響はありません。

---

## 原因③: マルチディスプレイのフォーカス管理

### 問題

2つのディスプレイに同時にオーバーレイを作成すると、**最後に作成されたウィンドウにフォーカスが移る**というOSの挙動があります。v1.2.2では表示順を制御していなかったため、カーソルがプライマリにあっても、セカンドのオーバーレイにフォーカスが奪われることがありました。

### 修正

```typescript
// カーソルのあるディスプレイを最後に作成
const cursorPoint = screen.getCursorScreenPoint()
const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint)
const sortedDisplays = [...allDisplays].sort((a, b) => {
  if (a.id === cursorDisplay.id) return 1   // カーソル側を後に
  if (b.id === cursorDisplay.id) return -1
  return 0
})

// さらにスクリーンショット読み込み完了時にも明示的にフォーカス
ipcMain.on('capture:screenshot-loaded', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    win.show()
    const cursorPoint = screen.getCursorScreenPoint()
    const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint)
    if (cursorDisplay.id === displayId) {
      win.focus()
      win.moveTop()
    }
  }
})
```

---

## デバッグで苦労した点

### 1. レンダラーのログが見えない

オーバーレイウィンドウはフルスクリーン・最前面で表示されるため、**DevToolsを開くとオーバーレイ自体が邪魔して操作できない**。メインプロセスのstdoutにはレンダラーのconsole.logが出力されないため、マウスイベントが本当に発火しているのかどうかの確認が困難でした。

対処法として、レンダラー側に以下のようなデバッグログを仕込みました：

```typescript
// RegionSelector.tsx
const handleMouseDown = (e: React.MouseEvent) => {
  console.log('[RegionSelector] mouseDown button:', e.button,
              'x:', e.clientX, 'y:', e.clientY)
  // ...
}
```

しかし**そもそもmouseDownが発火していない**ことが判明。問題はレンダラーのコードではなく、ウィンドウのOS レベルの入力ルーティングにあったことが分かりました。

### 2. 再現性が低い

「10回に1回だけ動く」という症状は、タイミング依存の問題を示唆しています。GPUプロセスの再初期化とウィンドウ作成が競合しており、タイミングによって成功/失敗が分かれていました。

### 3. 高DPI環境でしか発生しない

scaleFactor=1.0のセカンドディスプレイでは常に正常動作。scaleFactor=1.5のプライマリでのみ失敗するため、**DPIスケーリングとtransparentウィンドウの組み合わせ**が原因であることの特定に時間がかかりました。

### 4. 複数の原因が重なっていた

`mainWindow.destroy()`の問題だけ修正しても直らず、`transparent: true`だけ修正しても直らない。**3つの原因が重なって発生していた**ため、1つずつ修正しても改善が見えにくく、全てを同時に修正して初めて安定動作しました。

---

## 最終的に調整できなかった点・残課題

### 1. オーバーレイの完全透明背景

`transparent: false`に変更したことで、オーバーレイウィンドウの背景は`#000000`（黒）になりました。スクリーンショットのプレビューをCanvasで上に描画しているため見た目の問題はありませんが、**理想的には透明背景のまま動作させたい**ところです。

Windowsの高DPI環境で`transparent: true`のウィンドウがマウスイベントを正しく受け取る方法は、Electron/Chromiumのissueでも報告されていますが、根本的な解決策は見つかっていません。

### 2. desktopCapturer の2回呼び出し

Windowsでは`desktopCapturer.getSources()`を1回だけ呼ぶと、古いフレーム（エディタが映り込んだ残像）が返されることがあります。そのため**2回連続で呼び出し、500msの待機を挟む**というワークアラウンドを入れています：

```typescript
if (process.platform === 'win32') {
  await desktopCapturer.getSources(capturerOpts)  // 1回目（捨てる）
  await new Promise((r) => setTimeout(r, 500))
}
const sources = await desktopCapturer.getSources(capturerOpts)  // 2回目（使う）
```

これにより**キャプチャ開始までに約1秒の遅延**が発生します。Electronの`desktopCapturer`の仕様上、これを回避する方法は見つかっていません。

### 3. フォーカスの完全な制御

Windowsのウィンドウマネージャは、`alwaysOnTop`なウィンドウが複数あった場合のフォーカス挙動が完全には予測できません。現在のソート+明示的focus方式で概ね安定していますが、**極稀にセカンドディスプレイ側にフォーカスが移ることがある可能性**は残っています。

### 4. Electron の mixed-DPI バグ

v1.2.1で修正した問題ですが、Electronはウィンドウをセカンドディスプレイに作成する際、**プライマリのscaleFactorをそのまま適用する**バグがあります。`setBounds()`で強制上書きすることで対処していますが、Electron側の根本修正を待つ必要があります。

```typescript
// ウィンドウ作成後に強制的に正しいサイズを設定
win.setBounds({ x, y, width, height })

// ready-to-show時にも再チェック
win.once('ready-to-show', () => {
  const current = win.getBounds()
  if (current.width !== width || current.height !== height) {
    win.setBounds({ x, y, width, height })
  }
})
```

---

## 変更差分サマリー

v1.2.2（640cf27）→ v1.3.0（0fbd666）の主な変更：

| 変更箇所 | Before | After |
|----------|--------|-------|
| mainWindow処理 | `destroy()` + 1000ms待機 | `hide()` + オフスクリーン + 500ms待機 |
| オーバーレイ透明度 | `transparent: true` | `transparent: false` + `backgroundColor: '#000000'` |
| ディスプレイ順序 | 制御なし | カーソル側を最後に作成 |
| フォーカス管理 | なし | `focus()` + `moveTop()` 明示指定 |
| キャプチャ後の表示 | Windows: トレイ通知のみ | 全プラットフォーム: `show()` + `focus()` |
| トレイ常駐 | あり | 廃止 |
| グローバルショートカット | Ctrl+Shift+S | 廃止（アプリ内Newボタンに統一） |

---

## まとめ

Electronでマルチディスプレイ×高DPI×フルスクリーンオーバーレイという組み合わせは、OSレベルの挙動が絡むため非常にデバッグが難しい領域です。今回の教訓：

1. **`BrowserWindow.destroy()`は副作用が大きい** — 非表示にするだけで十分な場合が多い
2. **`transparent: true`はWindows高DPIで信頼できない** — WS_EX_LAYEREDの制約を理解する
3. **複数の原因が重なると、個別修正では効果が見えにくい** — 系統的に全ての疑わしい箇所を同時に修正する勇気が必要
4. **フルスクリーンオーバーレイのデバッグにはIPC経由のログ転送が有効** — DevToolsが使えない状況を想定する

---

*この記事はMarkShot v1.3.0の開発過程を記録したものです。*
*GitHub: https://github.com/tsubasagit/MarkShot*
