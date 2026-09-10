// 드래그로 고른 구간의 요약 (순수 로직)
//
// **끌고 나면 다음 질문은 늘 같다** — «여기 몇 건이고, 얼마나 느렸고, 몇 개가 터졌나».
// 지금까지는 건수만 적혀 있어서 그 답을 목록을 훑어 눈으로 세야 했다.
// 제니퍼 X-View 가 선택 구간 옆에 작은 요약을 두는 것도 같은 이유다.
//
// **축을 따라간다.** 점 높이가 SQL Time 인데 요약이 Elapsed 를 말하면
// «왜 3초짜리가 맨 밑에 있나» 가 다시 시작된다 (`formatYValue` 주석의 그 일이다).

import { Y_AXIS_CONFIGS, type SXLog, type YAxisMode } from '../types/xlog';

export interface SelectionStats {
  count: number;
  errors: number;
  /**
   * 실패 비율 (0~1). **0건이면 `null`** — 없는 것을 «0%» 로 적지 않는다.
   */
  errorRate: number | null;
  /**
   * 축 값의 평균. 단위는 축의 것이다 (`formatYAmount` 로 적는다).
   *
   * 0건이면 `null` — 0 을 적으면 «순식간에 끝났다» 로 읽힌다.
   */
  avg: number | null;
  /** 축 값의 최댓값. 0건이면 `null` */
  max: number | null;
  /**
   * 고른 것들이 걸쳐 있는 시간 폭(ms).
   *
   * 끈 사각형의 폭이 아니라 **실제로 들어온 것들의** 폭이다 — 빈 구간을 넓게 끌면
   * 사각형은 넓어도 트랜잭션은 한순간에 몰려 있을 수 있고, 그때 «3분» 이라고
   * 적으면 TPS 를 잘못 짐작하게 된다. 한 건이면 0.
   */
  spanMs: number;
  /** 이 요약이 보고 있는 축 */
  mode: YAxisMode;
  /** 그 시간이 어디로 갔나. 축과 무관하게 늘 낸다 */
  breakdown: ElapsedBreakdown;
}

/**
 * 소요 시간이 어디로 갔나 — **한 건 평균**(ms).
 *
 * 축은 한 번에 하나만 그릴 수 있다. 점 하나에 높이가 하나뿐이라 Elapsed 와 SQL Time 을
 * 동시에 세울 방법이 없고, 억지로 겹치면 «이 높이가 어느 쪽 값인가» 를 말할 수 없게 된다
 * (`formatYValue` 주석의 그 혼란이다).
 *
 * **그래서 고른 뒤에 한자리에서 본다.** «평균 1,240ms» 다음 질문은 늘
 * «그 1,240 이 SQL 이었나 API 였나» 이고, 그건 축을 바꿔 가며 두 번 끄는 대신
 * 여기서 한 번에 답할 수 있다.
 */
export interface ElapsedBreakdown {
  /** 전체 평균(ms) */
  totalMs: number;
  sqlMs: number;
  apiMs: number;
  /**
   * 어느 쪽도 아닌 시간 — 전체에서 SQL·API 를 뺀 것.
   *
   * **음수는 0 으로 둔다.** 비동기로 겹쳐 돌면 SQL+API 가 전체를 넘을 수 있다.
   */
  restMs: number;
  /**
   * SQL+API 가 전체를 넘었는가.
   *
   * 넘었다면 **«나머지» 를 믿으면 안 된다** — 0 으로 눌러 둔 값이라 «남는 시간이
   * 없다» 로 읽히는데, 실제로는 겹쳐 돌아서 더할 수 없는 것뿐이다. 화면이 그렇게 말한다.
   */
  overlapped: boolean;
}

/**
 * 고른 트랜잭션들을 한 줄로 접는다.
 *
 * **비어 있으면 수를 만들어 내지 않는다.** 평균 0·최대 0 은 «빨랐다» 로 읽히는데,
 * 그건 «고른 것이 없다» 와 정반대의 말이다.
 */
export function selectionStats(
  xlogs: readonly SXLog[],
  mode: YAxisMode,
): SelectionStats {
  const empty: SelectionStats = {
    count: 0,
    errors: 0,
    errorRate: null,
    avg: null,
    max: null,
    spanMs: 0,
    mode,
    breakdown: { totalMs: 0, sqlMs: 0, apiMs: 0, restMs: 0, overlapped: false },
  };
  if (xlogs.length === 0) return empty;

  const extract = Y_AXIS_CONFIGS[mode].valueExtractor;
  let sum = 0;
  let max = -Infinity;
  let errors = 0;
  let first = Infinity;
  let last = -Infinity;
  let elapsedSum = 0;
  let sqlSum = 0;
  let apiSum = 0;

  for (const x of xlogs) {
    const v = extract(x);
    // NaN 이 하나 섞이면 합계가 통째로 NaN 이 된다. 그런 건은 세지 않는다.
    if (Number.isFinite(v)) {
      sum += v;
      if (v > max) max = v;
    }
    if (x.error !== 0) errors += 1;
    if (x.endTime < first) first = x.endTime;
    if (x.endTime > last) last = x.endTime;

    // 내역은 **축과 무관하게** 늘 소요시간 기준이다. 하나가 NaN 이면 합이 통째로 NaN 이 된다.
    if (Number.isFinite(x.elapsed)) elapsedSum += x.elapsed;
    if (Number.isFinite(x.sqlTime)) sqlSum += x.sqlTime;
    if (Number.isFinite(x.apiCallTime)) apiSum += x.apiCallTime;
  }

  const count = xlogs.length;
  const totalMs = Math.round(elapsedSum / count);
  const sqlMs = Math.round(sqlSum / count);
  const apiMs = Math.round(apiSum / count);
  const rest = totalMs - sqlMs - apiMs;

  return {
    breakdown: {
      totalMs,
      sqlMs,
      apiMs,
      restMs: Math.max(0, rest),
      overlapped: rest < 0,
    },
    count,
    errors,
    errorRate: errors / count,
    avg: sum / count,
    max: Number.isFinite(max) ? max : null,
    spanMs: Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : 0,
    mode,
  };
}

/**
 * 시간 폭을 짧게.
 *
 * 1분을 넘으면 분으로 적는다 — `184,000ms` 는 자릿수를 세어야 읽힌다.
 */
export function formatSpan(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const sec = ms / 1_000;
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}초`;
  const min = sec / 60;
  return `${min < 10 ? min.toFixed(1) : Math.round(min)}분`;
}

/**
 * 고른 구간의 초당 처리량.
 *
 * **시간 폭이 없으면 `null` 이다.** 한 건만 고르거나 같은 순간에 몰려 있으면
 * 0 으로 나누게 되는데, 그때 나오는 Infinity 를 «무한 TPS» 로 적을 수는 없다.
 * 폭이 너무 짧아도(1초 미만) 말하지 않는다 — 두 건을 0.1초 폭으로 고르면
 * «20 TPS» 가 나오는데 그건 고른 방식이 만든 수지 서버의 성질이 아니다.
 */
export function selectionTps(s: SelectionStats): number | null {
  if (s.count === 0 || s.spanMs < 1_000) return null;
  return s.count / (s.spanMs / 1_000);
}
