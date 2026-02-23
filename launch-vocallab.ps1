# VocalLab Master Launch Script
# This script runs the Backend, Dashboard, and Mobile apps simultaneously.

Write-Host "Starting VocalLab Ecosystem..." -ForegroundColor Cyan

$ProjectRoot = "c:\Users\bmkir\Desktop\vocallab"

# 1. Start Backend
Write-Host "Starting Backend (FastAPI)..." -ForegroundColor Yellow
$BackendDir = Join-Path $ProjectRoot "backend"
Start-Process powershell -WorkingDirectory $BackendDir -ArgumentList "-NoExit", "-Command", "..\venv\Scripts\activate; uvicorn main:app --host 0.0.0.0 --port 8000"

# 2. Start Dashboard
Write-Host "Starting Dashboard (Vite)..." -ForegroundColor Yellow
$DashDir = Join-Path $ProjectRoot "dashboard"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -Path '$DashDir'; npm run dev"

# 3. Start Mobile
Write-Host "Starting Mobile (LAN Mode)..." -ForegroundColor Yellow
$MobileDir = Join-Path $ProjectRoot "mobile"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -Path '$MobileDir'; npx expo start --lan -c"

Write-Host "All systems are starting in separate windows!" -ForegroundColor Green
Write-Host "----------------------------------------------------"
Write-Host "Backend:   http://localhost:8000"
Write-Host "Dashboard: http://localhost:5173"
Write-Host "Mobile:    Scan the QR code in the Mobile window."
Write-Host "----------------------------------------------------"
