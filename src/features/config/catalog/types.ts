// 설정 카탈로그의 모양
//
// 카탈로그는 두 겹이다.
//   · `official.ts` — 스카우터 공식 설정 문서에서 **그대로** 뽑은 원문 (생성 파일)
//   · `ko.ts`       — 그 원문을 근거로 붙인 한국어 이름·설명
//
// 둘을 나눈 이유: 공식 문서가 바뀌면 원문은 다시 뽑으면 되지만, 한국어는 사람이 읽고
// 고쳐야 한다. 섞어 두면 다시 뽑을 때 번역이 날아간다.

/** 어느 쪽 설정인가 */
export type ConfigScope = 'server' | 'java' | 'host';

/** 공식 문서의 항목 하나 — `Configure.java` 의 필드 */
export interface OfficialOption {
  key: string;
  /** 문서의 구역 주석(`//Network`). 앞에 주석이 없으면 `(구역 없음)` */
  section: string;
  /** 자바 필드 타입 (`int` · `boolean` · `String` …) */
  type: string;
  /** 소스에 적힌 기본값 식. **실제 기본값은 살아 있는 서버가 준다** — 여기는 참고다 */
  default: string;
  /** `@ConfigDesc` 원문. 비어 있으면 공식 설명이 없는 항목이다 */
  desc: string;
  /** `@ConfigValueType` 이 붙어 있으면 그 이름 */
  valueType?: string;
}

export type OfficialCatalog = Record<ConfigScope, OfficialOption[]>;

/**
 * 한국어 이름과 설명.
 *
 * 설명을 비워 두면 화면은 공식 원문(영어)을 보여 준다. 이름만으로 뜻이 다 드러나는
 * 항목(«UDP 포트»)에 같은 말을 한 번 더 적지 않으려는 것이다.
 */
export type KoEntry = readonly [label: string, desc?: string];

export type KoCatalog = Record<ConfigScope, Record<string, KoEntry>>;
