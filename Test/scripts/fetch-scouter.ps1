# Scouter 릴리스 바이너리를 내려받아 vendor/ 에 전개한다.
# vendor/ 는 .gitignore 대상이므로 클론 직후 한 번 실행해야 한다.
$ErrorActionPreference = "Stop"

$TestRoot = Split-Path -Parent $PSScriptRoot
Set-Location $TestRoot

$env_vars = @{}
Get-Content "$TestRoot\.env" | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    $env_vars[$k.Trim()] = $v.Trim()
}
$ver = $env_vars['SCOUTER_VERSION']

$url = "https://github.com/scouter-project/scouter/releases/download/v$ver/scouter-all-$ver.tar.gz"
$tarball = "$TestRoot\scouter-all-$ver.tar.gz"

if (-not (Test-Path $tarball)) {
    Write-Host "[fetch] 다운로드: $url"
    Invoke-WebRequest -Uri $url -OutFile $tarball
} else {
    Write-Host "[fetch] 기존 tarball 사용: $tarball"
}

New-Item -ItemType Directory -Force -Path "$TestRoot\vendor" | Out-Null

# server / agent.java / agent.host 만 전개한다 (client, webapp 은 불필요)
Write-Host "[fetch] vendor/ 에 전개"
tar -xzf $tarball -C "$TestRoot\vendor" scouter/server scouter/agent.java scouter/agent.host
if ($LASTEXITCODE -ne 0) { throw "tar 전개 실패" }

Remove-Item $tarball
Write-Host "[fetch] 완료 — vendor\scouter\{server, agent.java, agent.host}"
