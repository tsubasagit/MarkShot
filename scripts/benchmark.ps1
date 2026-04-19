# MarkShot パフォーマンスベンチマーク
# Markshot1 (Electron) と Markshot2 (Tauri) を同条件で比較するための計測スクリプト
#
# 使用例:
#   powershell -ExecutionPolicy Bypass -File .\scripts\benchmark.ps1 -Label markshot1
#   powershell -ExecutionPolicy Bypass -File .\scripts\benchmark.ps1 -Label markshot2 -ExePath "C:\path\to\markshot2.exe" -ProcessName "markshot"
#
# 出力: benchmark-results/<label>-<timestamp>.json

param(
    [string]$ExePath      = "$env:LOCALAPPDATA\Programs\MarkShot\MarkShot.exe",
    [string]$ProcessName  = "MarkShot",
    [string]$Label        = "markshot1",
    [int]$StabilizeSec    = 5,
    [int]$StartupTimeoutSec = 30
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ExePath)) {
    Write-Error "実行ファイルが見つかりません: $ExePath"
    exit 1
}

# 既存プロセスをクリア
Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# 起動時間計測（メインウィンドウ表示まで）
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $ExePath -PassThru
while ($sw.Elapsed.TotalSeconds -lt $StartupTimeoutSec) {
    Start-Sleep -Milliseconds 100
    try { $proc.Refresh() } catch { }
    if ($proc.MainWindowHandle -ne 0) { break }
}
$startupMs = $sw.ElapsedMilliseconds
if ($proc.MainWindowHandle -eq 0) {
    Write-Warning "メインウィンドウが ${StartupTimeoutSec}s 以内に表示されませんでした"
}

# 安定化待機（lazy load や後続プロセス生成を待つ）
Start-Sleep -Seconds $StabilizeSec

# メモリ計測（同名プロセスを全て合算。Electron は子プロセス多数）
$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
if (-not $procs) {
    Write-Error "プロセス '$ProcessName' が見つかりません"
    exit 1
}
$workingSetMB    = [math]::Round(($procs | Measure-Object -Property WorkingSet64       -Sum).Sum / 1MB, 2)
$privateMB       = [math]::Round(($procs | Measure-Object -Property PrivateMemorySize64 -Sum).Sum / 1MB, 2)
$pagedMB         = [math]::Round(($procs | Measure-Object -Property PagedMemorySize64   -Sum).Sum / 1MB, 2)
$processCount    = $procs.Count

# インストールサイズ
$installDir = Split-Path $ExePath -Parent
$installSizeMB = [math]::Round(
    (Get-ChildItem $installDir -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum / 1MB, 2)

# 後片付け
Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$result = [ordered]@{
    label            = $Label
    timestamp        = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
    exePath          = $ExePath
    processName      = $ProcessName
    startupMs        = $startupMs
    processCount     = $processCount
    workingSetMB     = $workingSetMB
    privateMemoryMB  = $privateMB
    pagedMemoryMB    = $pagedMB
    installSizeMB    = $installSizeMB
    host             = $env:COMPUTERNAME
    os               = (Get-CimInstance Win32_OperatingSystem).Caption
}

# 結果保存
$outDir = Join-Path $PSScriptRoot "..\benchmark-results"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path $outDir "$Label-$stamp.json"
$result | ConvertTo-Json | Out-File -FilePath $outFile -Encoding utf8

# 表示
Write-Host ""
Write-Host "=== MarkShot Benchmark: $Label ===" -ForegroundColor Cyan
$result.GetEnumerator() | ForEach-Object {
    "{0,-18} {1}" -f $_.Key, $_.Value
}
Write-Host ""
Write-Host "保存先: $outFile" -ForegroundColor Green
