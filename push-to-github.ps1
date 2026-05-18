# Run from license-server folder. Uploads the FULL folder tree to GitHub (including src/ and public/).
# Usage:
#   .\push-to-github.ps1
#   .\push-to-github.ps1 -RepoUrl "https://github.com/other/repo.git"

param(
  [string]$RepoUrl = "https://github.com/elgranprincipebna-cpu/license-server.git"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$required = @(
  "package.json",
  "tsconfig.json",
  "railway.toml",
  "src\index.ts",
  "src\routes.ts",
  "src\db.ts",
  "src\middleware\adminAuth.ts",
  "public\index.html"
)

Write-Host "Checking required files..." -ForegroundColor Cyan
foreach ($f in $required) {
  if (-not (Test-Path $f)) {
    Write-Host "MISSING: $f" -ForegroundColor Red
    exit 1
  }
  Write-Host "  OK  $f"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git is not installed. Install from https://git-scm.com/download/win" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".git")) {
  git init
  git branch -M main
}

git add package.json tsconfig.json railway.toml .gitignore .env.example
git add src/
git add public/

Write-Host ""
Write-Host "Files that will be committed:" -ForegroundColor Cyan
git status --short

$hasSrc = git diff --cached --name-only | Select-String "^src/"
if (-not $hasSrc) {
  Write-Host ""
  Write-Host "ERROR: src/ folder is not staged. Use Git, not the GitHub website upload." -ForegroundColor Red
  exit 1
}

git commit -m "License server with src and public folders" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Nothing new to commit (or commit failed)." -ForegroundColor Yellow
}

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  git remote add origin $RepoUrl
} else {
  git remote set-url origin $RepoUrl
}

Write-Host ""
Write-Host "Pushing to $RepoUrl ..." -ForegroundColor Cyan
git push -u origin main

Write-Host ""
Write-Host "Done. On GitHub you must see folder src with .ts files inside." -ForegroundColor Green
