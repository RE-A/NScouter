# YAScouter

> **Yet Another Scouter** — Scouter APM 모던 클라이언트

Java 기반 Eclipse RCP 클라이언트를 **Tauri + Rust + React + TypeScript**로 재구현한 데스크톱 애플리케이션. Scouter Collector에 직접 TCP 연결하여 XLog 트랜잭션을 실시간으로 Canvas 스캐터 차트에 시각화한다.

---

## 주요 특징

- **Java 불필요** — Rust 백엔드가 Collector TCP 프로토콜을 직접 구현
- **실시간 스캐터 차트** — Canvas + Uint8Array PointMap으로 초당 수만 점 렌더링
- **크로스 플랫폼** — Windows / macOS / Linux 단일 코드베이스

---

## 스택

| 영역 | 기술 |
|------|------|
| 데스크톱 프레임워크 | Tauri v2 |
| 백엔드 | Rust (tokio, serde, sha2) |
| 프론트엔드 | React 19 + TypeScript (strict) |
| 렌더링 | HTML5 Canvas 2D (DOM 렌더링 금지) |
| 빌드 | Vite + cargo |

---

## 빠른 시작

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (Tauri + Vite 동시)
npm run tauri dev

# 릴리스 빌드
npm run tauri build
```

---

## 문서

→ **[docs/](docs/README.md)** 에서 전체 문서 확인

| 문서 | 내용 |
|------|------|
| [아키텍처 가이드](docs/architecture.md) | 시스템 구조, 데이터 흐름, 모듈 의존 관계 |
| [개발 가이드](docs/dev-guide.md) | 환경 세팅, 디렉토리 구조, 코드 컨벤션, 새 기능 추가 |
| [배포 가이드](docs/deploy-guide.md) | 빌드, 플랫폼별 패키징, 릴리스 절차 |

---

## 네트워크 요구사항

```
YAScouter (클라이언트 PC)  ──TCP :6100──►  Scouter Collector (서버)
```

Scouter Collector가 설치된 서버의 **TCP 6100 포트**가 클라이언트에서 접근 가능해야 한다.
