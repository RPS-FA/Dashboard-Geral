# Dashboard OPS — setup git local (executar uma vez na pasta do projecto)
$ErrorActionPreference = "Stop"
Write-Host "== Dashboard OPS: setup git ==" -ForegroundColor Green
if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules; Write-Host "node_modules removido." }
if (Test-Path package-lock.json) { Remove-Item -Force package-lock.json; Write-Host "package-lock.json removido." }
if (-not (Test-Path .git)) { git init; git branch -M main }
git add .
git commit -m "Dashboard OPS — commit inicial"
Write-Host "Pronto. Liga ao GitHub e faz push (ver DEPLOY.md)." -ForegroundColor Green
