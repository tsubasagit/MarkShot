# MarkShot パフォーマンス比較ガイド

Markshot1（Electron）と Markshot2（Tauri + WebView2）の性能を同条件で計測・比較するための手順。

## 目的

- **メモリ削減目標**: 起動直後 ~100MB → ~30MB（Windows Snipping Tool 同等）
- 定量的に削減効果を示し、ユーザー体験の改善を裏付ける

## 計測項目

| 項目 | 意味 | Snipping Tool 参考値 |
|---|---|---|
| `startupMs` | 実行から最初のメインウィンドウ表示までの ms | ~500ms |
| `processCount` | 同名プロセスの合計数 | 1〜2 |
| `workingSetMB` | 全プロセスの Working Set 合計 | ~30MB |
| `privateMemoryMB` | 全プロセスの Private Memory 合計 | ~25MB |
| `installSizeMB` | インストールフォルダ総サイズ | ~15MB |

Electron アプリは main / renderer / GPU / utility などに分離されるため、
**同名プロセスを全て合算** して Snipping Tool と公平に比較する。

## 計測手順

### 1. Markshot1 (Electron) の計測

インストール済みの MarkShot.exe（v1.3.7）に対して：

```powershell
cd C:\Users\tsuba\AppTalentHub\02_product\01_projects\public\markshot
powershell -ExecutionPolicy Bypass -File .\scripts\benchmark.ps1 -Label markshot1
```

デフォルトで `%LOCALAPPDATA%\Programs\MarkShot\MarkShot.exe` を起動して計測する。

### 2. Markshot2 (Tauri) の計測

Markshot2 ビルド完了後：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\benchmark.ps1 `
    -Label markshot2 `
    -ExePath "C:\path\to\markshot2.exe" `
    -ProcessName "markshot2"
```

Tauri の実行ファイル名・プロセス名が確定し次第、パスを差し替える。

### 3. 比較レポート出力

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compare.ps1
```

最新の `markshot1-*.json` と `markshot2-*.json` を読み、差分と削減率を表示する。

## 結果の保管

- 生データ: `benchmark-results/<label>-<yyyymmdd_hhmmss>.json`（.gitignore で除外）
- 公開用スナップショット: このドキュメント末尾の「計測ログ」に手動追記

## 公平性のための注意点

- 計測前に両アプリを完全終了してからスクリプトを起動する
- 同一マシン・同一電源状態（AC接続・スリープなし）で実施する
- Stabilize 秒数（デフォルト5秒）は両バージョンで揃える
- バックグラウンドの Chrome / VSCode などは閉じておく
- 初回起動はディスクキャッシュの影響を受けるため、2回目の値を採用する

## 計測ログ

### Markshot1 ベースライン（v1.4.0, Electron 28）

計測機: Surface Laptop 7 / ARM64 / Windows 11 Home / 16GB
2回計測・2回目の値を採用（キャッシュ温まり後の安定値）

| 日付 | startupMs | processCount | workingSetMB | privateMemoryMB | installSizeMB |
|---|---|---|---|---|---|
| 2026-04-20 | 418 | 4 | 290.6 | 180.9 | 259.2 |

**所感:**
- 起動は速い（418ms）— Electron アプリとしては優秀
- **Working Set 合計 ~290MB** — Task Manager の「Memory」欄で見える値より大きい。Task Manager は private working set のみを表示するため（~180MB）、ユーザーが「100MB」と認識していた値は**メインプロセス単体の private working set** と推定
- **プロセス数 4** — main + renderer + GPU + utility（典型的な Electron 構成）
- **インストールサイズ 259MB** — Chromium ランタイム同梱のため巨大

**Markshot2 削減目標:**

| 指標 | Markshot1 | Markshot2 目標 | 削減率 |
|---|---|---|---|
| workingSetMB | 290 | 60 | -79% |
| privateMemoryMB | 181 | 30 | -83% |
| processCount | 4 | 1〜2 | -50〜75% |
| installSizeMB | 259 | 15 | -94% |

いずれも Snipping Tool 並みが到達目標。

### Markshot2（Tauri + WebView2）

**計測予定** — Markshot2 MVP 完成後に追記。

| 日付 | startupMs | processCount | workingSetMB | privateMemoryMB | installSizeMB |
|---|---|---|---|---|---|
| TBD | | | | | |
