# VocalLab Mobile Fix & Run Script
# This script ensures dependencies are correct and starts Expo in the most reliable mode for your network.

Write-Host "🚀 Starting VocalLab Mobile Fix Automation..." -ForegroundColor Cyan

# 1. Clean cache if requested
if ($args -contains "-clean") {
    Write-Host "🧹 Cleaning Metro cache..." -ForegroundColor Yellow
    Remove-Item -r -Force .expo | Out-Null
}

# 2. Check for common issues
Write-Host "🔍 Verifying environment..." -ForegroundColor Gray
npm install --legacy-peer-deps --no-audit --no-fund
npx expo-doctor

# 3. Determine start mode
$mode = "--tunnel"
if ($args -contains "-local") {
    $mode = ""
}

Write-Host "✨ Launching Expo in $($mode) mode..." -ForegroundColor Green
Write-Host "💡 If you get 'Offline' errors, please use Tunnel mode (default)." -ForegroundColor Cyan

npx expo start $mode -c
