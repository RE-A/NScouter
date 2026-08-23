// src/features/xlog/types/profile.ts
// XLog 프로파일 타입 정의 (Rust XLogProfilePack 직렬화 구조)
// 참조: docs/asis/01-common-data-model.md 섹션 1.2

// ─── Step 공통 기반 ───────────────────────────────────────────

export interface StepBase {
  parent: number;      // 부모 Step index (-1 = 루트)
  index: number;       // 이 Step의 인덱스
  start_time: number;  // 트랜잭션 시작으로부터 상대 시간 (ms)
  start_cpu: number;
}

// ─── 각 Step 타입 ─────────────────────────────────────────────

export interface MethodStep extends StepBase {
  kind: 'Method';
  hash: number;     // text_type::METHOD 로 조회
  elapsed: number;  // ms (MethodStep2만 유효, 나머지 0)
  cputime: number;  // ms (MethodStep2만 유효, 나머지 0)
}

export interface SqlStep extends StepBase {
  kind: 'Sql';
  hash: number;     // text_type::SQL 로 조회
  param: string;    // SQL 바인딩 파라미터
  elapsed: number;  // ms
  error: number;    // 에러 hash (0=정상)
  updated: number;  // 영향받은 행 수
}

export interface ApiCallStep extends StepBase {
  kind: 'ApiCall';
  hash: number;     // text_type::APICALL 로 조회
  elapsed: number;  // ms
  error: number;    // 에러 hash (0=정상)
  txid: string;     // 연관 트랜잭션 ID (i64 → string)
  address: string;  // API endpoint 주소
}

export interface MessageStep extends StepBase {
  kind: 'Message';
  message: string;  // 직접 텍스트 (MessageStep)
  hash: number;     // 해시 (HashedMessageStep, 0이면 message 사용)
}

export interface SocketStep extends StepBase {
  kind: 'Socket';
  ipaddr: string;
  port: number;
  elapsed: number;
  error: number;
}

/**
 * ThreadCallPossibleStep — 여기서 다른 스레드로 넘어갔을 수 있다는 표시.
 *
 * `threaded` 가 true 면 실제로 넘어갔고 `txid` 가 **그 스레드의 트랜잭션**이다.
 * 그 프로파일을 열면 이어지는 작업이 보인다 (ASIS XLogThreadProfileView).
 */
export interface ThreadCallStep extends StepBase {
  kind: 'ThreadCall';
  /** 넘어간 스레드의 트랜잭션 ID (i64 → string). '0' 이면 없다 */
  txid: string;
  hash: number;
  elapsed: number;
  threaded: boolean;
}

export interface UnknownStep {
  kind: 'Unknown';
  step_type: number;
}

export type ProfileStep =
  | MethodStep
  | SqlStep
  | ApiCallStep
  | MessageStep
  | SocketStep
  | ThreadCallStep
  | UnknownStep;

// ─── XLogProfile ─────────────────────────────────────────────

/** Rust XLogProfilePack 직렬화 구조 */
export interface XLogProfilePack {
  txid: string;     // i64 → string
  obj_hash: number;
  steps: ProfileStep[];
}

/** 텍스트가 해석된 XLog 프로파일 (UI 표시용) */
export interface ResolvedProfile {
  txid: string;
  obj_hash: number;
  steps: ProfileStep[];
  texts: Record<number, string>;  // hash → text (서비스명, SQL, API URL, 에러 등)
}

// ─── Step 관련 유틸 ───────────────────────────────────────────

/** Step에서 수집해야 할 hash 목록 반환 (텍스트 해석용) */
export function collectStepHashes(steps: ProfileStep[]): {
  method: number[];
  sql: number[];
  apicall: number[];
  error: number[];
  hmsg: number[];
} {
  const method: number[] = [];
  const sql: number[] = [];
  const apicall: number[] = [];
  const error: number[] = [];
  const hmsg: number[] = [];

  for (const step of steps) {
    switch (step.kind) {
      case 'Method':
        if (step.hash !== 0) method.push(step.hash);
        break;
      case 'Sql':
        if (step.hash !== 0) sql.push(step.hash);
        if (step.error !== 0) error.push(step.error);
        break;
      case 'ApiCall':
        if (step.hash !== 0) apicall.push(step.hash);
        if (step.error !== 0) error.push(step.error);
        break;
      case 'Message':
        // HashedMessageStep 은 **`hmsg`** 타입이다 (ASIS TextTypes.HASH_MSG).
        // `method` 로 조회하면 에러 없이 빈 결과가 와서 해시가 그대로 남는다.
        if (step.hash !== 0) hmsg.push(step.hash);
        break;
      case 'ThreadCall':
        // 이름은 apicall 사전에 있다 (ASIS XLogFlowView 도 apicall 로 푼다).
        if (step.hash !== 0) apicall.push(step.hash);
        break;
    }
  }

  return { method, sql, apicall, error, hmsg };
}
