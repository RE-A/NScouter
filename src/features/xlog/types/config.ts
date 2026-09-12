// 설정 조회 타입 (에이전트 / 콜렉터)
//
// Rust `scouter::configure::ConfigView` 와 짝이다.

/**
 * 값 종류. ASIS `scouter.lang.conf.ValueType` · Rust `configure::value_type` 과 번호가 같다.
 *
 * 0 은 «모른다» — 에이전트가 안 줬다(오래된 판). 그때 화면은 글자 칸을 준다.
 */
export const VALUE_TYPE = {
  UNKNOWN: 0,
  VALUE: 1,
  NUM: 2,
  BOOL: 3,
  /** `a,b,c` */
  COMMA_SEPARATED: 4,
  /** `a:1,b:2` */
  COMMA_COLON_SEPARATED: 5,
} as const;

export type ValueType = (typeof VALUE_TYPE)[keyof typeof VALUE_TYPE];

export interface ConfigEntry {
  key: string;
  value: string;
  default: string;
  /** 기본값과 다른가. **이걸 보려고 여는 화면이다** */
  changed: boolean;
  /**
   * 이 항목이 무엇을 하는가. **에이전트 자신이 준다** (`@ConfigDesc`).
   * 오래된 에이전트는 안 준다 — 그때 빈 문자열이다.
   */
  desc: string;
  /** 값 종류 (`VALUE_TYPE`). 0 은 «모른다» */
  value_type: number;
}

export interface ConfigView {
  /** 설정 파일 원문. 파일이 없으면 빈 문자열 */
  text: string;
  entries: ConfigEntry[];
}
