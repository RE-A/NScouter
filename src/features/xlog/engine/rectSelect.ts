// 드래그 선택 (순수 로직)
//
// **화면에 찍힌 점을 세면 안 된다.** 렌더러는 이미 점이 있는 자리를 건너뛴다
// (XLogViewPainter 의 충돌 회피). 5x5 짜리 점 하나가 25px 를 막으므로 촘촘한 구간에서는
// 실제 트랜잭션의 대부분이 그려지지 않는다.
//
// 픽셀 지도로 선택을 만들면 그 "안 그려진" 건들이 통째로 사라진다 —
// 실측에서 5,000건 남짓한 구간이 339건으로 나왔다. 목록이 짧은 것보다
// **개수가 거짓말을 하는 것**이 더 나쁘다. "이 구간에 339건뿐"으로 읽힌다.
//
// 그래서 선택은 픽셀이 아니라 **데이터**를 훑는다. 좌표 변환은 그릴 때와 같은
// mapper 를 쓰므로 눈에 보이는 사각형과 결과가 어긋나지 않는다.

import type { CoordinateMapper } from './CoordinateMapper';
import type { SelectionRect } from './XLogChartRenderer';
import type {
  FilterField,
  PatternRule,
  SXLog,
  TextFilter,
  XLogFilterState,
} from '../types/xlog';

/**
 * 부분 일치 (대소문자 무시) + 포함/제외.
 *
 * 조건이 비면 **방향과 무관하게 통과**시킨다 — 빈 제외 조건으로 전부를 지우면 안 된다.
 */
export function matchesText(value: string, cond: TextFilter): boolean {
  const needle = cond.text.trim().toLowerCase();
  if (needle === '') return true;
  const hit = value.toLowerCase().includes(needle);
  return cond.exclude ? !hit : hit;
}

/**
 * 차트에 그릴 대상인가 — 렌더러와 선택이 같은 기준을 써야 한다.
 *
 * `serviceName` 은 해시를 이름으로 바꾸는 함수다. **아직 못 푼 해시는 빈 이름으로 본다** —
 * 포함 조건이면 빠지고 제외 조건이면 남는다. 이름이 채워지면 다시 그려지면서 맞춰진다.
 * (판단을 보류하고 통과시키면 포함 조건인데 엉뚱한 점이 섞여 보인다.)
 */
export function passesFilter(
  xlog: SXLog,
  filter: XLogFilterState,
  serviceName?: (hash: number) => string | undefined,
): boolean {
  if (filter.errorOnly && xlog.error === 0) return false;

  // 0 은 "조건 없음" 이다. 미만으로 읽으면 아무것도 통과하지 못한다.
  if (filter.elapsedMs > 0) {
    const pass = filter.elapsedExclude
      ? xlog.elapsed < filter.elapsedMs
      : xlog.elapsed >= filter.elapsedMs;
    if (!pass) return false;
  }

  if (filter.objHashSet.size > 0 && !filter.objHashSet.has(xlog.objHash)) return false;

  // 자리마다 값이 다르다. 서비스명은 해시를 풀어야 하고 IP 는 그대로 있다.
  const valueOf = (field: FilterField): string =>
    field === 'service' ? (serviceName?.(xlog.service) ?? '') : xlog.ipAddr;

  return passesPatterns(filter.patterns, valueOf);
}

/**
 * 패턴들을 판정한다.
 *
 * **자리 안에서는 OR, 자리끼리는 AND** 다.
 *   · 같은 자리의 포함 조건이 여럿이면 «하나라도 맞으면» 통과 —
 *     아니면 «이 URL 과 저 URL» 을 동시에 만족할 수 없어 늘 0건이 된다
 *   · 제외 조건은 «하나라도 맞으면» 뺀다
 *   · 서비스 조건과 IP 조건은 둘 다 만족해야 한다
 * 빈 글자는 조건이 아니다 — 빈 제외 조건으로 전부를 지우면 안 된다.
 */
export function passesPatterns(
  patterns: readonly PatternRule[],
  valueOf: (field: FilterField) => string,
): boolean {
  const fields = new Set(patterns.filter(r => r.text.trim() !== '').map(r => r.field));

  for (const field of fields) {
    const value = valueOf(field).toLowerCase();
    const rules = patterns.filter(r => r.field === field && r.text.trim() !== '');

    const excludes = rules.filter(r => r.exclude);
    if (excludes.some(r => value.includes(r.text.trim().toLowerCase()))) return false;

    const includes = rules.filter(r => !r.exclude);
    if (includes.length > 0 && !includes.some(r => value.includes(r.text.trim().toLowerCase()))) {
      return false;
    }
  }
  return true;
}

/**
 * 사각형 안의 XLog 를 **전부** 돌려준다.
 *
 * 순서는 원본(시간 순)을 유지한다. 픽셀 훑기와 달리 y(=Elapsed) 순으로 섞이지 않는다.
 */
export function selectInRect(
  data: readonly SXLog[],
  rect: SelectionRect,
  mapper: CoordinateMapper,
  filter: XLogFilterState,
  serviceName?: (hash: number) => string | undefined,
): SXLog[] {
  // 드래그는 어느 방향으로든 할 수 있다. 뒤집힌 사각형도 같은 결과여야 한다.
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);

  const out: SXLog[] = [];
  for (const xlog of data) {
    if (!passesFilter(xlog, filter, serviceName)) continue;

    const { x, y } = mapper.dataToPixel(xlog.endTime, mapper.extractValue(xlog));
    // 플롯 영역 밖은 그려지지도 않는다. 축 바깥까지 드래그해도 안 잡혀야 한다.
    if (!mapper.isInPlotArea(x, y)) continue;
    if (x < left || x > right || y < top || y > bottom) continue;

    out.push(xlog);
  }
  return out;
}
