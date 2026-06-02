# Full deploy: Netlify + GitHub Pages + Gitee + source push
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

npm run deploy:netlify
powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\deploy-pages.ps1")
powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\deploy-source.ps1")
Write-Host "Done: full deploy complete."
