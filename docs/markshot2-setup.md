# Markshot2 開発環境セットアップ

Markshot2 は **Tauri 2 (Rust + WebView2)** で全面改修中。このドキュメントは
markshot2 ブランチ（v2.x）の開発環境構築手順を扱う。Markshot1（Electron 版、
v1.4.0）のビルドは `markshot1` ブランチを参照。

## 目的

| | Markshot1 (Electron) | Markshot2 (Tauri) 目標 |
|---|---|---|
| workingSetMB | 290 | 60 |
| privateMemoryMB | 181 | 30 |
| processCount | 4 | 1〜2 |
| installSizeMB | 259 | 15 |

ベンチマーク計測手順は `docs/benchmark.md` 参照。

## 必要なツール（Windows）

### 1. Node.js（既にインストール済みのはず）

```powershell
node --version  # v18 以上
npm --version
```

### 2. WebView2 Runtime（Win10/11 にプリインストール済み）

```powershell
Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
```

### 3. Rust toolchain

[rustup-init.exe](https://rustup.rs) をダウンロードして実行。インストールオプションはデフォルトで可。

```powershell
rustup show active-toolchain
# stable-aarch64-pc-windows-msvc (ARM64 機) もしくは stable-x86_64-pc-windows-msvc
```

### 4. Visual Studio Build Tools (C++)

Tauri は MSVC リンカを必要とする。以下のいずれか：

**A. Visual Studio Build Tools（軽量・推奨）**
1. [Build Tools for Visual Studio 2022](https://aka.ms/vs/17/release/vs_BuildTools.exe) をダウンロード
2. インストーラで「C++ によるデスクトップ開発」ワークロードを選択
3. ダウンロードサイズ約 6〜8 GB

**B. Visual Studio Community**（IDEも使う場合）

詳細: <https://tauri.app/start/prerequisites/#windows>

### 5. 確認

```powershell
rustc --version
cargo --version
cl.exe    # MSVC link tool
```

## セットアップ

```powershell
cd C:\Users\tsuba\AppTalentHub\02_product\01_projects\public\markshot
npm install
```

Rust 依存は初回 `cargo build` または `npm run dev` 実行時に自動ダウンロード
（数分〜十数分）。以降は `target/` にキャッシュ。

## 開発コマンド

```powershell
npm run dev        # Tauri dev (Vite + Rust hot-reload)
npm run build      # 本番ビルド -> src-tauri/target/release/bundle/nsis/*.exe
npm run dev:vite   # Vite だけ起動（UI のみ確認したいとき）
npm run test       # Vitest
```

## 移行ステータス

### 完了
- [x] `src-tauri/` スキャフォールド（Cargo.toml, main.rs, lib.rs, tauri.conf.json）
- [x] プラグイン宣言（shell, dialog, fs, clipboard-manager, global-shortcut）
- [x] `package.json` Tauri 化（Electron 依存削除、@tauri-apps/* 追加）
- [x] `vite.config.ts` Tauri 向け調整
- [x] アイコン `src-tauri/icons/` 設置
- [x] `electron/` ディレクトリ削除（`markshot1` ブランチに保存済み）

### 未着手（React 側移行）

`src/components/*.tsx` は `window.electronAPI` を呼んでいるため、Tauri の
`@tauri-apps/api` + `invoke` へ書き換えが必要。優先順：

1. **スクリーンショット取得** — `tauri-plugin-screenshots` 追加、または Rust で `win32::GetDC` 直叩き
2. **領域選択オーバーレイ** — `WebviewWindow` 複数起動（Electron の BrowserWindow 相当）
3. **クリップボード/保存** — `@tauri-apps/plugin-clipboard-manager` / `plugin-fs`
4. **グローバルショートカット** — `@tauri-apps/plugin-global-shortcut`
5. **設定永続化** — `tauri-plugin-store` 追加 or Rust 側で JSON ファイル読み書き
6. **Google Drive 連携** — `tauri-plugin-oauth` 検討（Markshot1 の 294 行実装を移植）

### MVP で削減する機能（ユーザー合意済み）

- GIF 録画（Konva/gifenc 依存、複雑なオーバーレイ構成）
- 動画録画（WebM）
- アノテーションエディタ（Konva ベース、将来 Phase 2 で復活検討）

MVP は「領域選択 → PNG → クリップボード or 保存」のみ。Snipping Tool 相当の
シンプル機能で `workingSetMB ≤ 60` を目指す。
