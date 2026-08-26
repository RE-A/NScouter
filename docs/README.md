# NScouter 문서 인덱스

> **NScouter** — Scouter APM 모던 클라이언트 (Tauri + Rust + React + TypeScript)

---

## Claude 참조용 (작업 전에 읽을 것)

| 문서 | 언제 읽나 |
|------|-----------|
| [실측 검증 사실](verified-facts.md) | **프로토콜/와이어 포맷을 건드리기 전 필수.** 소스나 ASIS 문서와 충돌하면 이 문서가 우선한다 |
| [인벤토리 원본 확정](asis/15-inventory-source-of-truth.md) | **"Scouter가 뭘 보여주나"를 물을 때 필수.** 카운터·뷰·메뉴의 authoritative 원본과 소스 링크. 이관율 분모 |
| [테스트 전략 (TDD)](testing-strategy.md) | 기능 추가·버그 수정 시작 전. 계층 선택과 RED 확인 방법 |
| [테스트 설계](test-design.md) | 프로젝트 목표(이관율/정확성/성능/사용성)를 테스트로 번역한 설계 |
| [성능 기준선](perf-baseline.md) | 실측 수치와 회귀 가드 임계값. 성능 관련 변경 전후로 확인 |
| [아키텍처 가이드](architecture.md) | 모듈 구조·데이터 흐름 파악 |
| [TCP 프로토콜 명세](asis/14-collector-tcp-protocol.md) | 직렬화 포맷 상세 (단, 실측과 충돌 시 verified-facts 우선) |

## 사람이 읽는 문서

| 문서 | 설명 |
|------|------|
| [백로그](backlog.md) | **실환경에서 나온 수정 요청.** 로컬(오브젝트 5개)에서는 안 보이는 것들 |
| [사용자 가이드](user-guide.md) | **앱 사용법** — 접속, XLog 필터·검색, 흐름 보기, 카운터, 오브젝트 작업, 설정 |
| [개발 가이드](dev-guide.md) | 환경 세팅, 디렉토리 구조, 코드 컨벤션 |
| [배포 가이드](deploy-guide.md) | 빌드, 플랫폼별 패키징, 릴리스 체크리스트 |
| [테스트 환경 사용법](../Test/README.md) | 로컬 Scouter 환경 기동/종료/부하 생성 |

---

## 테스트 환경 (`../Test/`)

실제 Scouter Collector + 에이전트가 붙은 Spring Boot 앱을 컨테이너로 띄운다.
프로토콜 작업의 검증 기반이다.

| 문서 | 내용 |
|------|------|
| [Test/README.md](../Test/README.md) | 실행 방법 (사람용) |
| [Test/PLAN.md](../Test/PLAN.md) | 구축 계획·검증 근거·리스크 이력 |
| [Test/NSCOUTER-ISSUES.md](../Test/NSCOUTER-ISSUES.md) | 이 환경에서 발견·수정한 NScouter 결함 4건 |

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
| [14-collector-tcp-protocol](asis/14-collector-tcp-protocol.md) | **TCP 프로토콜 완전 명세** |
| [15-inventory-source-of-truth](asis/15-inventory-source-of-truth.md) | **인벤토리 원본 확정** — 소스 링크 포함. 이관율 분모 |

> 00~14는 소스 정적 분석의 **요약**이다. 수치가 필요하면 요약이 아니라
> [15번 문서](asis/15-inventory-source-of-truth.md)나 원본 소스를 본다
> (요약본에서 뽑은 분모가 실제와 달랐던 사례가 있다).
> 실제 서버 동작과 다른 부분은 [verified-facts.md](verified-facts.md)가 우선한다.

## 설계 문서 (`plans/`)

| 문서 | 내용 |
|------|------|
| [tauri-backend-scouter-client](plans/tauri-backend-scouter-client.md) | Rust 백엔드 상세 설계 |
| [xlog-renderer-prototype](plans/xlog-renderer-prototype.md) | Canvas 렌더러 상세 설계 |
