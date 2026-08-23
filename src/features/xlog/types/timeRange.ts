// XLog 조회 구간 (순수 로직)
//
// 앱은 지금까지 "현재"만 봤다. 과거 구간을 보려면 구간을 **명시적으로** 들고 있어야 한다.

/** 실시간(흐르는 창) 또는 과거(고정 구간) */
export type XLogMode = 'live' | 'past';

export interface PastRange {
  /** 로컬 기준 시작 (epoch ms) */
  stime: number;
  /** 로컬 기준 끝 (epoch ms) */
  etime: number;
}

/** 조회 가능한 최대 구간. 넘으면 수십만 건이라 화면과 메모리가 버티지 못한다 */
export const MAX_PAST_SPAN_MS = 6 * 60 * 60 * 1000; // 6시간

/** `<input type="datetime-local">` 값 ↔ epoch ms */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 콜렉터가 프로파일·XLog 를 저장하는 **날짜 디렉토리** 키.
 *
 * 콜렉터는 자기 타임존 기준 날짜로 저장하고 클라이언트는 로컬 날짜로 조회한다.
 * 둘이 다르면 조용히 0건이 된다 (F-18). 여기서는 로컬 날짜를 쓴다 —
 * 테스트 환경은 콜렉터도 Asia/Seoul 이다.
 */
export function yyyymmdd(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export interface RangeCheck {
  ok: boolean;
  /** 사용자에게 보여줄 이유. ok 면 null */
  reason: string | null;
}

/**
 * 조회 전에 구간을 검사한다.
 *
 * **조회를 눌러 놓고 0건이 나오는 게 이 프로토콜의 실패 방식이라**(F-15),
 * 우리가 먼저 걸러 이유를 말해 주는 편이 낫다.
 */
export function checkRange(range: PastRange, now: number): RangeCheck {
  if (!Number.isFinite(range.stime) || !Number.isFinite(range.etime)) {
    return { ok: false, reason: '시간 형식이 올바르지 않습니다.' };
  }
  if (range.etime <= range.stime) {
    return { ok: false, reason: '끝 시각이 시작 시각보다 뒤여야 합니다.' };
  }
  if (range.stime > now) {
    return { ok: false, reason: '시작 시각이 미래입니다.' };
  }
  if (range.etime - range.stime > MAX_PAST_SPAN_MS) {
    return { ok: false, reason: '구간이 너무 깁니다. 6시간 이내로 좁혀 주세요.' };
  }
  // 콜렉터는 날짜 디렉토리 단위로 저장한다. 날짜를 걸치면 한 번의 요청으로 못 가져온다.
  if (yyyymmdd(range.stime) !== yyyymmdd(range.etime)) {
    return { ok: false, reason: '하루를 넘는 구간은 아직 지원하지 않습니다.' };
  }
  return { ok: true, reason: null };
}

/** 기본 구간 — 최근 10분 */
export function defaultPastRange(now: number): PastRange {
  return { stime: now - 10 * 60 * 1000, etime: now };
}

/** 더 좁히면 점이 몇 개 없어 볼 게 없다 */
export const MIN_PAST_SPAN_MS = 5_000;

/** 하루의 시작·끝 (로컬) */
function dayBounds(ms: number): { start: number; end: number } {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 - 1 };
}

/** 구간을 하루 안으로, 길이를 [MIN, MAX] 안으로 민다 */
function clampToDay(stime: number, span: number, anchor: number): PastRange {
  const { start: dayStart, end: dayEnd } = dayBounds(anchor);
  const width = Math.min(span, dayEnd - dayStart);
  let s = stime;
  if (s < dayStart) s = dayStart;
  if (s + width > dayEnd) s = dayEnd - width;
  return { stime: Math.round(s), etime: Math.round(s + width) };
}

/**
 * 커서 위치를 고정한 채 구간을 확대/축소한다.
 *
 * 커서 아래의 시각이 **그대로 커서 아래 남아야** 확대가 예측 가능하다.
 * 가운데를 기준으로 하면 보고 있던 지점이 화면 밖으로 달아난다.
 *
 * @param anchorRatio 커서의 가로 위치 (0=왼쪽 끝, 1=오른쪽 끝)
 * @param factor      1보다 작으면 확대, 크면 축소
 */
export function zoomRange(range: PastRange, anchorRatio: number, factor: number): PastRange {
  const span = Math.max(1, range.etime - range.stime);
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const anchor = range.stime + ratio * span;

  const nextSpan = Math.min(MAX_PAST_SPAN_MS, Math.max(MIN_PAST_SPAN_MS, span * factor));
  return clampToDay(anchor - ratio * nextSpan, nextSpan, anchor);
}

/**
 * 길이를 유지한 채 좌우로 민다.
 *
 * @param deltaRatio 구간 길이 대비 이동량. 양수면 미래 쪽.
 */
export function panRange(range: PastRange, deltaRatio: number): PastRange {
  const span = Math.max(1, range.etime - range.stime);
  const shifted = range.stime + deltaRatio * span;
  // 날짜 기준은 **원래 구간**이다. 이동한 위치로 잡으면 전날로 밀었을 때
  // 전날에 고정돼 버려서, 막으려던 날짜 넘기를 오히려 하게 된다.
  return clampToDay(shifted, span, range.stime + span / 2);
}

/**
 * 보는 창이 받아온 구간을 벗어났는가.
 *
 * 확대는 이미 받아둔 데이터 안에서 일어나므로 **재조회가 필요 없다.**
 * 벗어날 때만 다시 받는다 — 휠을 굴릴 때마다 수만 건을 다시 받으면 못 쓴다.
 */
export function needsRefetch(view: PastRange, loaded: PastRange | null): boolean {
  if (!loaded) return true;
  return view.stime < loaded.stime || view.etime > loaded.etime;
}
