# VocalLab Master Launch Script — v2.0.0
# Usage: Run from ANY directory. Script auto-resolves project root.
# All 3 services start in separate PowerShell windows.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
# Resolve project root: if script is in root use that, if in mobile/ go up one level
if (Test-Path (Join-Path $ScriptDir "backend")) {
    $ProjectRoot = $ScriptDir
}
else {
    $ProjectRoot = Split-Path -Parent $ScriptDir
}

$BackendDir = Join-Path $ProjectRoot "backend"
$DashboardDir = Join-Path $ProjectRoot "dashboard"
$MobileDir = Join-Path $ProjectRoot "mobile"
$VenvActivate = Join-Path $ProjectRoot "venv\Scripts\Activate.ps1"

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  VocalLab Ecosystem Launcher  (v2.0.0)            " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Project Root : $ProjectRoot" -ForegroundColor DarkGray
Write-Host "  Backend      : $BackendDir"  -ForegroundColor DarkGray
Write-Host "  Dashboard    : $DashboardDir" -ForegroundColor DarkGray
Write-Host "  Mobile       : $MobileDir"   -ForegroundColor DarkGray
Write-Host ""

# ── 1. Backend (FastAPI + uvicorn) ───────────────────────────────
Write-Host "  [1/3] Starting Backend (FastAPI)..." -ForegroundColor Yellow
$backendCmd = "Write-Host 'VocalLab Backend' -ForegroundColor Cyan; " +
"Set-Location -Path '$BackendDir'; " +
"if (Test-Path '$VenvActivate') { & '$VenvActivate' } else { Write-Host 'venv not found — using system Python' -ForegroundColor Yellow }; " +
"python main.py"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

# ── 2. Dashboard (Vite dev server) ───────────────────────────────
Write-Host "  [2/3] Starting Dashboard (Vite)..." -ForegroundColor Yellow
$dashCmd = "Write-Host 'VocalLab Dashboard' -ForegroundColor Cyan; " +
"Set-Location -Path '$DashboardDir'; " +
"npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $dashCmd

# ── 3. Mobile (Expo LAN mode) ────────────────────────────────────
Write-Host "  [3/3] Starting Mobile (Expo LAN)..." -ForegroundColor Yellow
$mobileCmd = "Write-Host 'VocalLab Mobile' -ForegroundColor Cyan; " +
"Set-Location -Path '$MobileDir'; " +
"npx expo start --lan -c"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $mobileCmd

# ── Summary ──────────────────────────────────────────────────────
Start-Sleep -Seconds 2
Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host "  All 3 services starting in separate windows!     " -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend   ->  http://localhost:8000"       -ForegroundColor White
Write-Host "  Backend   ->  http://localhost:8000/docs"  -ForegroundColor White
Write-Host "  Dashboard ->  http://localhost:5173"       -ForegroundColor White
Write-Host "  Mobile    ->  Scan QR code in Mobile window" -ForegroundColor White
Write-Host ""
Write-Host "  TIP: Update mobile/app.json backendUrl if your IP changes." -ForegroundColor DarkGray
Write-Host "  TIP: Run backend/verify_setup.py to check all 15 requirements." -ForegroundColor DarkGray
Write-Host ""
