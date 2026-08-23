# 테스트 환경 종료
$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)
podman-compose down
