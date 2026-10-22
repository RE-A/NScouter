#!/bin/bash
# 클라우드(Claude Code on the web) 세션 시작 시 빌드·테스트 환경을 갖춘다.
# 로컬(Windows 등)에서는 아무것도 하지 않는다.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Tauri v2 Linux 빌드용 시스템 라이브러리. 이미 있으면 건너뛴다.
if ! pkg-config --exists webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 2>/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
    librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
    build-essential pkg-config libssl-dev
fi

# 프론트 의존성. 컨테이너 캐시를 살리려고 npm ci 대신 install 을 쓴다.
npm install --no-audit --no-fund

# Rust 의존성 소스만 받아 둔다 (컴파일은 첫 cargo test 때).
(cd src-tauri && cargo fetch)
