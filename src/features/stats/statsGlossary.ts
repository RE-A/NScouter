// 용어 설명 — 표 머리·칩·상세·보고서에 툴팁으로 붙인다
//
// 함수로 둔다 — 모듈 상수에 `t()` 를 부르면 임포트 때 한 번만 번역돼 언어를 바꿔도 안 따라온다(coverage.test).
// 판정 설명은 지금 판정 규칙의 숫자로 만든다 — 설정을 바꾸면 설명도 바뀐다.

import { t } from '../../i18n';
import type { Flag, JudgeRules } from './statsJudge';
import { slowName, type MetricKey } from './statsFormat';

export type Term = MetricKey | 'p50' | 'ref' | 'past' | 'vs' | 'tps' | 'max' | 'sql' | 'api' | 'cpu' | 'verdict';

export function termHelp(k: Term): string {
  switch (k) {
    case 'ref':
      return t('기준 — 살펴보는 시점. 이 구간을 과거와 견줍니다.');
    case 'past':
      return t('과거 — 견줄 지난 시점. 여러 구간을 넣었으면 과거 칸은 날마다 낸 값의 평균(일평균)입니다.\n펼친 상세에 일자별 값과 최소·최대가 있습니다.');
    case 'vs':
      return t('과거 대비 — 기준이 과거보다 얼마나 변했나.\n2배 이상은 ×배수(×4.1), 그 밖은 %(+78%, −31%), 10% 안쪽은 비웁니다.\n에러율은 %p 차이입니다. 빨간 칸은 판정에 걸린 것입니다.');
    case 'count':
      return t('건수 — 그 구간에 끝난 트랜잭션 수.\n과거 구간이 여럿이면 과거 쪽은 구간당 평균입니다.');
    case 'avg':
      return t('평균 응답시간 — 응답시간 합 ÷ 건수.\n아주 느린 몇 건에 끌려 올라갈 수 있어 p90 과 함께 봅니다.');
    case 'p50':
      return t('p50 (중앙값) — 빠른 순으로 늘어놓았을 때 한가운데 응답시간.\n절반은 이보다 빠르고 절반은 느립니다. «보통 요청» 이 느려졌는지 봅니다.');
    case 'p90':
      return t('p90 (90번째 백분위) — 빠른 순으로 늘어놓았을 때 90% 지점의 응답시간.\n10건 중 1건은 이보다 느립니다. «대부분의 사용자가 겪는 느림» 을 봅니다.');
    case 'p99':
      return t('p99 (99번째 백분위) — 100건 중 가장 느린 1건 바로 앞의 응답시간.\n드물게 아주 느린 요청(꼬리)을 봅니다. 건수가 적으면 크게 흔들립니다.');
    case 'err':
      return t('에러율 — 에러난 트랜잭션의 비율.\n과거 대비는 %p(퍼센트포인트) 차이입니다 — 1% → 3% 는 +2.0%p.');
    case 'tps':
      return t('TPS — 초당 트랜잭션 수. 건수 ÷ 실제로 받은 시간(못 받은 조각은 뺍니다).');
    case 'max':
      return t('최대 — 가장 느렸던 한 건의 응답시간.');
    case 'sql':
      return t('SQL 시간 — 트랜잭션 한 건이 SQL 에 쓴 시간의 평균.');
    case 'api':
      return t('API 시간 — 트랜잭션 한 건이 바깥 API 호출에 쓴 시간의 평균.');
    case 'cpu':
      return t('CPU — 트랜잭션 한 건이 쓴 CPU 시간의 평균.');
    case 'verdict':
      return t('판정 — 판정 규칙(⚙ 통계 설정)으로 고른 특이사항. 옆의 글자는 걸린 까닭입니다.');
  }
}

/** 느려짐 조건 — 켠 것만, 둘이면 «그리고»/«또는»(slowCombine) */
export function slowCondText(r: JudgeRules): string {
  const parts = [
    ...(r.slowUseRatio ? [`${t('과거의')} ${r.slowRatio}${t('배 이상')}`] : []),
    ...(r.slowUseMs ? [`${r.slowMinMs}ms ${t('이상 늘어남')}`] : []),
  ];
  return parts.join(r.slowCombine === 'or' ? ` ${t('또는')} ` : ` ${t('그리고')} `);
}

/** 에러 증가 조건 — 같은 방식 */
export function errCondText(r: JudgeRules): string {
  const parts = [
    ...(r.errorUseRatio ? [`${t('과거의')} ${r.errorRatio}${t('배 이상')}`] : []),
    ...(r.errorUsePp ? [`${(r.errorMinDelta * 100).toFixed(1)}%p ${t('이상 늘어남')}`] : []),
  ];
  return parts.join(r.errorCombine === 'or' ? ` ${t('또는')} ` : ` ${t('그리고')} `);
}

/** 판정 하나의 뜻 — 지금 규칙의 숫자로 */
export function flagHelp(f: Flag, r: JudgeRules): string {
  const worst = r.beyondWorst ? `\n${t('과거가 여럿이면 과거 날들 중 가장 나빴던 날보다도 나쁠 때만입니다.')}` : '';
  switch (f) {
    case 'errors':
      return `${t('에러 증가 — 에러율이')} ${errCondText(r)}.${worst}`;
    case 'slow':
      return `${t('느려짐 —')} ${r.slowOn.map(m => slowName(m, t)).join('·')} ${t('중 하나가')} ${slowCondText(r)}.${worst}`;
    case 'volume':
      return `${t('호출량 급변 — TPS 가 과거에서')} ±${Math.round(r.volumeRatio * 100)}% ${t('넘게 변했습니다.')}`;
    case 'new':
      return t('기준에만 있음 — 과거 구간에는 없던 서비스입니다.');
    case 'gone':
      return t('과거에만 있음 — 기준 구간에는 없던 서비스입니다.');
    case 'few':
      return `${t('표본 적음 — 한쪽이')} ${r.minCount}${t('건 미만이라 판정하지 않았습니다.')}`;
  }
}
