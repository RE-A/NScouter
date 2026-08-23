# k6 부하 생성 시작 / 중지
#
#   .\scripts\load.ps1            부하 시작 (백그라운드)
#   .\scripts\load.ps1 -Follow    부하 시작 후 로그 따라가기
#   .\scripts\load.ps1 -Stop      부하 중지
#
# 부하량은 .env 의 K6_VUS / K6_DURATION 으로 조절한다.
param(
    [switch]$Stop,
    [switch]$Follow
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if ($Stop) {
    Write-Host "[load] 중지"
    podman rm -f load-gen 2>&1 | Out-Null
    Write-Host "[load] 중지 완료"
    return
}

# 이전 실행분이 남아 있으면 정리
podman rm -f load-gen 2>&1 | Out-Null

Write-Host "[load] 시작 — podman-compose --profile load up -d load-gen"
podman-compose --profile load up -d load-gen
if ($LASTEXITCODE -ne 0) { throw "부하 생성기 기동 실패" }

if ($Follow) {
    podman logs -f load-gen
} else {
    Write-Host "[load] 진행 중. 로그: podman logs -f load-gen"
}
