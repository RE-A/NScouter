# NScouter 배포 가이드

---

## 1. 빌드 개요

NScouter는 Tauri v2 기반 데스크톱 앱이다. 단일 `npm run tauri build` 명령으로 플랫폼 네이티브 설치 파일을 생성한다.

```
빌드 흐름:

  npm run tauri build
       │
       ├─ 1. npm run build (Vite)
       │       └─ dist/          ← 번들된 React SPA
       │
       └─ 2. cargo build --release (Rust)
               └─ src-tauri/target/release/
                       ├─ NScouter.exe           (Windows 실행파일)
                       └─ bundle/
                               ├─ msi/            ← Windows 설치 패키지
                               ├─ nsis/           ← Windows 경량 인스톨러
                               ├─ deb/            ← Debian/Ubuntu 패키지
                               ├─ rpm/            ← Fedora/RHEL 패키지
                               └─ macos/          ← macOS .app + .dmg
```

---

## 2. 빌드 전 체크리스트

```
□ cargo check 통과 (Rust 컴파일 오류 없음)
□ tsc --noEmit 통과 (TypeScript 타입 오류 없음)
□ cargo test 통과 (단위 테스트 전체 통과)
□ tauri.conf.json 버전 번호 업데이트
□ Cargo.toml 버전 번호 업데이트 (동일 버전으로 맞춤)
□ 테스트 서버 연결 확인 (Collector :6100 접근 가능)
```

---

## 3. 빌드 명령

### 3.1 단독 실행파일 빌드 (기본 권장)

인스톨러 없이 `.exe` 하나만 생성한다. Tauri 번들러를 거치지 않아 빌드가 빠르다.

```bash
# 의존성 설치 (최초 1회 또는 package.json 변경 시)
npm install

# 단독 실행파일 빌드
npm run build:exe
```

산출물:
```
src-tauri/target/release/nscouter.exe
```

프론트엔드가 exe 안에 내장되므로 **exe 파일 하나만 복사해서 배포**하면 된다.
설정 파일(`config.json`)과 로그(`logs/`)는 실행 시 exe 옆에 자동 생성된다.

> **WebView2**: Windows 11은 OS 내장. Windows 10은 별도 설치 필요.
> 수동 설치: https://developer.microsoft.com/microsoft-edge/webview2/

---

### 3.2 인스톨러 빌드

설치 패키지(MSI, NSIS)까지 함께 생성한다. 배포용 설치 파일이 필요할 때 사용한다.

```bash
npm run build:installer
```

산출물:
```
src-tauri/target/release/bundle/
  ├─ msi/    ← Windows MSI 설치 파일
  └─ nsis/   ← Windows NSIS 경량 인스톨러
```

### 3.3 플랫폼별 타겟 지정 빌드

```bash
# Windows MSI만 빌드
npm run tauri build -- --bundles msi

# Windows NSIS 인스톨러만 빌드
npm run tauri build -- --bundles nsis

# macOS .app만 빌드 (macOS에서 실행해야 함)
npm run tauri build -- --bundles app

# Linux .deb만 빌드
npm run tauri build -- --bundles deb
```

### 3.4 디버그 빌드 (느리지만 디버그 심볼 포함)

```bash
npm run tauri build -- --debug
```

---

## 4. 플랫폼별 요구사항

### Windows

| 항목 | 요구사항 |
|------|----------|
| OS | Windows 10 v1803+ 또는 Windows 11 |
| WebView2 | Windows 11 기본 내장. Windows 10은 자동 다운로드 설치 |
| Visual C++ | MSVC Build Tools 2019+ |
| 아키텍처 | x86_64 (ARM64 미지원) |

```bash
# Windows 빌드 추가 도구 (최초 1회)
rustup target add x86_64-pc-windows-msvc
# Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
```

배포 파일:
- `bundle/msi/NScouter_0.1.0_x64_en-US.msi` — 표준 MSI 설치 파일
- `bundle/nsis/NScouter_0.1.0_x64-setup.exe` — 경량 설치 파일 (권장)

### macOS

| 항목 | 요구사항 |
|------|----------|
| OS | macOS 10.15 (Catalina)+ |
| Xcode | Command Line Tools 설치 필요 |
| 아키텍처 | Apple Silicon(arm64) + Intel(x86_64) 크로스 빌드 가능 |

```bash
# Apple Silicon용 빌드
rustup target add aarch64-apple-darwin

# Universal Binary (Intel + Apple Silicon)
npm run tauri build -- --target universal-apple-darwin
```

> **코드 서명**: 배포 시 Apple Developer Program 인증서로 서명 필요. 미서명 앱은 Gatekeeper 경고 발생.

### Linux

| 항목 | 요구사항 |
|------|----------|
| 배포판 | Ubuntu 20.04+ / Debian 11+ / Fedora 35+ |
| 의존성 | `libwebkit2gtk-4.1`, `libgtk-3`, `libayatana-appindicator3` |

```bash
# Ubuntu/Debian 의존성 설치
sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

---

## 5. `tauri.conf.json` 설정

배포 전 반드시 확인:

```json
{
  "productName": "NScouter",
  "version": "0.1.0",             // ← 버전 업데이트
  "identifier": "com.company.NScouter",  // ← 고유 식별자 (변경 금지)
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "NScouter",
        "width": 1280,             // ← 기본 창 크기 조정 권장
        "height": 800,
        "minWidth": 800,
        "minHeight": 600
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/..."]
  }
}
```

---

## 6. 버전 관리

### 버전 업데이트 절차

버전은 두 파일에서 동일하게 관리:

```bash
# 1. tauri.conf.json
"version": "0.2.0"

# 2. src-tauri/Cargo.toml
version = "0.2.0"
```

### 버전 번호 규칙

`MAJOR.MINOR.PATCH` (SemVer)

| 변경 유형 | 예시 | 버전 증가 |
|-----------|------|-----------|
| 프로토콜 호환성 변경, 대규모 재설계 | Collector v3 지원 추가 | MAJOR |
| 새 기능 추가 (하위 호환) | 새 Y축 모드, 필터 옵션 | MINOR |
| 버그 수정, 성능 개선 | 렌더링 버그 수정 | PATCH |

---

## 7. CI/CD (GitHub Actions 예시)

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install Linux dependencies
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run tauri build

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os }}-bundle
          path: src-tauri/target/release/bundle/
```

---

## 8. 배포 후 확인 사항

### 연결 테스트

```
1. Scouter Collector 서버 정보 확인
   - IP/호스트명
   - TCP 포트 (기본 6100)
   - 방화벽 규칙 (클라이언트 → Collector :6100 허용 필요)

2. 계정 확인
   - Scouter admin 계정 비밀번호
   - 비밀번호는 SHA-256(salt + password)로 해시되어 전송됨

3. NScouter 실행 후 연결 테스트
   - ConnectionDialog에 서버 정보 입력
   - "연결됨" 표시 확인
   - XLog 점이 차트에 표시되는지 확인
```

### 네트워크 요구사항

```
클라이언트 PC  ──────► Scouter Collector
               TCP :6100
               (단방향: 클라이언트가 연결 요청)

방화벽 규칙:
  - 클라이언트 PC의 아웃바운드 TCP :6100 허용
  - Collector 서버의 인바운드 TCP :6100 허용
  - UDP 불필요 (TCP 전용)
```

---

## 9. 트러블슈팅

### 빌드 실패

**증상:** `cargo build` 실패, `linking with link.exe failed`

```bash
# 해결: Visual C++ Build Tools 재설치
# https://visualstudio.microsoft.com/downloads/ → Build Tools for VS
```

**증상:** `error: package 'xxx' failed to compile`

```bash
# Rust 캐시 클리어 후 재빌드
cd src-tauri
cargo clean
cd ..
npm run tauri build
```

### 실행 실패

**증상:** Windows에서 "WebView2 런타임 없음" 오류

```
NSIS 인스톨러가 WebView2를 자동 설치함.
수동 설치: https://developer.microsoft.com/microsoft-edge/webview2/
```

**증상:** Collector 연결 실패

```
1. Collector가 실행 중인지 확인
2. 포트 6100이 방화벽에서 허용되는지 확인
   Windows: netsh advfirewall firewall show rule name=all | findstr 6100
   Linux:   iptables -L | grep 6100
3. 서버 로그에서 클라이언트 연결 시도 확인
```

**증상:** `INVALID_SESSION` 에러로 연결 끊김

```
세션 만료 시 자동 재연결 없음.
ConnectionDialog에서 수동 재연결 필요.
(자동 재연결은 향후 구현 예정)
```

### 성능 문제

**증상:** 점이 많아질수록 차트가 느려짐

```
- XLogDataStore 최대 100,000건 유지 확인
- 시간 윈도우(기본 5분) 조정: XLogToolbar → 범위 선택
- 필터(최소 응답시간) 적용으로 표시 점 수 줄이기
```
