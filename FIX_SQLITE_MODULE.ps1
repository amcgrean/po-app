Write-Host "===============================================" -ForegroundColor Green
Write-Host "Rebuilding better-sqlite3 for Electron 27" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host ""

Write-Host "Current directory: $PWD" -ForegroundColor Cyan
Write-Host ""

Write-Host "Step 1: Removing existing better-sqlite3..." -ForegroundColor Yellow
Remove-Item -Path "node_modules\better-sqlite3" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Step 2: Installing better-sqlite3 for Electron..." -ForegroundColor Yellow
npm install better-sqlite3@9.2.2 --save

Write-Host ""
Write-Host "Step 3: Rebuilding for Electron..." -ForegroundColor Yellow
npm rebuild better-sqlite3 --update-binary

Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host "Done! You can now run: npm start" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to exit"