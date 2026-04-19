# ベンチマーク結果比較
# benchmark-results/ 配下の最新 markshot1-*.json と markshot2-*.json を読み、差分を表示

param(
    [string]$Label1 = "markshot1",
    [string]$Label2 = "markshot2"
)

$ErrorActionPreference = "Stop"
$resultsDir = Join-Path $PSScriptRoot "..\benchmark-results"
if (-not (Test-Path $resultsDir)) {
    Write-Error "benchmark-results/ がありません。まず benchmark.ps1 を実行してください。"
    exit 1
}

function Get-LatestResult($label) {
    $f = Get-ChildItem $resultsDir -Filter "$label-*.json" -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $f) { return $null }
    return Get-Content $f.FullName -Raw | ConvertFrom-Json
}

$r1 = Get-LatestResult $Label1
$r2 = Get-LatestResult $Label2

if (-not $r1) { Write-Error "$Label1 の結果がありません"; exit 1 }
if (-not $r2) { Write-Error "$Label2 の結果がありません"; exit 1 }

function Format-Delta($v1, $v2, $unit = "") {
    $delta = $v2 - $v1
    $pct = if ($v1 -ne 0) { [math]::Round(($delta / $v1) * 100, 1) } else { 0 }
    $sign = if ($delta -gt 0) { "+" } else { "" }
    $color = if ($delta -lt 0) { "Green" } elseif ($delta -gt 0) { "Red" } else { "Gray" }
    return @{ text = "$sign$delta$unit ($sign$pct%)"; color = $color }
}

Write-Host ""
Write-Host "=== MarkShot Benchmark Comparison ===" -ForegroundColor Cyan
Write-Host ("{0,-20} {1,-15} {2,-15} {3}" -f "Metric", $Label1, $Label2, "Delta")
Write-Host ("-" * 70)

$metrics = @(
    @{ key = "startupMs";       label = "Startup (ms)";     unit = "ms" }
    @{ key = "processCount";    label = "Process count";    unit = "" }
    @{ key = "workingSetMB";    label = "Working set (MB)"; unit = "MB" }
    @{ key = "privateMemoryMB"; label = "Private mem (MB)"; unit = "MB" }
    @{ key = "installSizeMB";   label = "Install (MB)";     unit = "MB" }
)

foreach ($m in $metrics) {
    $v1 = $r1.($m.key)
    $v2 = $r2.($m.key)
    $d  = Format-Delta $v1 $v2 $m.unit
    Write-Host ("{0,-20} {1,-15} {2,-15} " -f $m.label, $v1, $v2) -NoNewline
    Write-Host $d.text -ForegroundColor $d.color
}

Write-Host ""
Write-Host "$Label1 : $($r1.timestamp)"
Write-Host "$Label2 : $($r2.timestamp)"
