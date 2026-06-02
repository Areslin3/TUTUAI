# 构建并同步到 tutuai-pages，再推送到 GitHub Pages (main) 与 Gitee (gh-pages)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pages = Join-Path $root "tutuai-pages"

Set-Location $root
npm run build

Copy-Item (Join-Path $root "dist\index.html") (Join-Path $pages "index.html") -Force
$assetsDir = Join-Path $pages "assets"
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir | Out-Null }
Copy-Item (Join-Path $root "dist\assets\*") $assetsDir -Recurse -Force
$html = Join-Path $root "dist\兔兔及时达自动化部署进度查询系统.html"
if (Test-Path $html) { Copy-Item $html $pages -Force }

Set-Location $pages
git add .
$status = git status --porcelain
if ($status) {
  git commit -m "deploy: update github pages build"
}
git push github gh-pages:main
git push origin gh-pages
Write-Host "GitHub Pages 与 Gitee 已同步完成。"
