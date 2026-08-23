# 테스트 환경 이미지 빌드
# compose.yml 에 build: 섹션을 두지 않는 이유는 compose.yml 주석 참조.
$ErrorActionPreference = "Stop"

$TestRoot = Split-Path -Parent $PSScriptRoot
Set-Location $TestRoot

# .env 읽기
$env_vars = @{}
Get-Content "$TestRoot\.env" | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    $env_vars[$k.Trim()] = $v.Trim()
}
$ver = $env_vars['SCOUTER_VERSION']

if (-not (Test-Path "$TestRoot\vendor\scouter\server")) {
    throw "vendor/scouter 가 없습니다. scripts\fetch-scouter.ps1 을 먼저 실행하십시오."
}

Write-Host "[build] postgres -> nscouter-test/postgres:17"
podman build -f postgres\Containerfile -t "nscouter-test/postgres:17" .
if ($LASTEXITCODE -ne 0) { throw "postgres 이미지 빌드 실패" }

Write-Host "[build] collector -> nscouter-test/collector:$ver"
podman build -f collector\Containerfile -t "nscouter-test/collector:$ver" .
if ($LASTEXITCODE -ne 0) { throw "collector 이미지 빌드 실패" }

Write-Host "[build] host-agent -> nscouter-test/host-agent:$ver"
podman build -f agent-host\Containerfile -t "nscouter-test/host-agent:$ver" .
if ($LASTEXITCODE -ne 0) { throw "host-agent 이미지 빌드 실패" }

Write-Host "[build] shop-app -> nscouter-test/shop-app:latest"
podman build -f apps\shop\Containerfile -t "nscouter-test/shop-app:latest" .
if ($LASTEXITCODE -ne 0) { throw "shop-app 이미지 빌드 실패" }

Write-Host "[build] order-app -> nscouter-test/order-app:latest"
podman build -f apps\order\Containerfile -t "nscouter-test/order-app:latest" .
if ($LASTEXITCODE -ne 0) { throw "order-app 이미지 빌드 실패" }

Write-Host "[build] loadgen -> nscouter-test/loadgen:latest"
podman build -f loadgen\Containerfile -t "nscouter-test/loadgen:latest" .
if ($LASTEXITCODE -ne 0) { throw "loadgen 이미지 빌드 실패" }

Write-Host "[build] 완료"
