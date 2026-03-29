# NScouter 문서 인덱스

> **NScouter** — Scouter APM 모던 클라이언트 (Tauri + Rust + React + TypeScript)

---

## 문서 목록

| 문서 | 설명 |
|------|------|
| [아키텍처 가이드](architecture.md) | 전체 시스템 구조, 데이터 흐름, 모듈 설계, 레이어별 상세 |
| [개발 가이드](dev-guide.md) | 환경 세팅, 디렉토리 구조, 코드 컨벤션, 새 기능 추가 방법 |
| [배포 가이드](deploy-guide.md) | 빌드 방법, 플랫폼별 패키징, 버전 관리, 릴리스 체크리스트 |

---

## ASIS 분석 문서 (`asis/`)

기존 Java 기반 Scouter 클라이언트 분석 자료.

| 문서 | 내용 |
|------|------|
| [00-architecture-overview](asis/00-architecture-overview.md) | 전체 모듈 구조 |
| [01-common-data-model](asis/01-common-data-model.md) | Pack/Value 데이터 모델 |
| [02-common-network-protocol](asis/02-common-network-protocol.md) | 네트워크 프로토콜 |
| [07-client-xlog](asis/07-client-xlog.md) | XLog 뷰 분석 |
| [09-client-network](asis/09-client-network.md) | 클라이언트 네트워크 계층 |
| [14-collector-tcp-protocol](asis/14-collector-tcp-protocol.md) | **TCP 프로토콜 완전 명세** ← 구현의 핵심 참조 |

## 설계 문서 (`plans/`)

| 문서 | 내용 |
|------|------|
| [tauri-backend-scouter-client](plans/tauri-backend-scouter-client.md) | Rust 백엔드 상세 설계 |
| [xlog-renderer-prototype](plans/xlog-renderer-prototype.md) | Canvas 렌더러 상세 설계 |
