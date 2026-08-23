# 테스트 환경 기동 (빌드 포함)
$ErrorActionPreference = "Stop"

$TestRoot = Split-Path -Parent $PSScriptRoot

& "$PSScriptRoot\build.ps1"

Set-Location $TestRoot
Write-Host "[up] podman-compose up -d"
podman-compose up -d
if ($LASTEXITCODE -ne 0) { throw "기동 실패" }

podman-compose ps
