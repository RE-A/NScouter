// 콜렉터 요청 설정의 기본값.
//
// API 모듈(`scouterApi`)에 두지 않는다 — 테스트가 그 모듈을 통째로 갈아 끼우면 기본값까지 사라진다.

import type { PerfPrefs } from './scouterApi';

/** Rust `PerfPrefs::default` 와 같은 값이어야 한다 — 갈리면 설정 창이 «기본값» 이라고 보여주는 값과 실제가 달라진다 */
export const DEFAULT_PERF: PerfPrefs = {
  scan_parallel: 4,
  stats_parallel: 4,
  past_parallel: 8,
  profile_workers: 32,
  text_workers: 8,
  page_rows: 20_000,
  prefetch_enabled: true,
  prefetch_min_elapsed_ms: 3_000,
  prefetch_per_sec: 20,
};
