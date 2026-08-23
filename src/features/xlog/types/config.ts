// 설정 조회 타입 (에이전트 / 콜렉터)
//
// Rust `scouter::configure::ConfigView` 와 짝이다.

export interface ConfigEntry {
  key: string;
  value: string;
  default: string;
  /** 기본값과 다른가. **이걸 보려고 여는 화면이다** */
  changed: boolean;
}

export interface ConfigView {
  /** 설정 파일 원문. 파일이 없으면 빈 문자열 */
  text: string;
  entries: ConfigEntry[];
}
