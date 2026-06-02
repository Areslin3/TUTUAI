# Push source branch to GitHub
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

git push origin fix/sync-black-screen
git push origin fix/sync-black-screen:source
Write-Host "Done: source pushed to GitHub (fix/sync-black-screen + source)."
