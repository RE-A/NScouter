// 넓은 구간 찾기 — 구간을 조각으로 나눠 **넷씩 한꺼번에** 받고, 조건은 Rust 가 대소문자 없이 맞춘다.
//
// 예전에는 콜렉터 검색(SEARCH_XLOG_LIST)에 조건을 넘겼다. 그건 **대소문자를 가려서** `order` 로
// `/Order/…` 를 못 찾았고(콜렉터 `StrMatch` — 우회 불가), 한 번에 500건에서 말없이 끊겨 구간을
// 잘게 나눠 다시 물어야 했고, 오브젝트도 하나만 받았다. 지금은 과거 조회로 구간을 받아
// Rust(`search_xlog_page`)가 거른다 — 세 가지가 다 없어졌다.
//
//   1. 구간을 **날짜**(콜렉터 날짜 디렉토리, F-18)와 **5분** 으로 자른다
//   2. 조각 넷을 한꺼번에 — 조각마다 페이지(5,000건)를 끝까지 넘긴다
//   3. 화면으로는 **걸린 것만** 온다 — 페이지마다 따로 와서 한 덩어리가 크지 않다(CLAUDE.md 3.3)
//
// **늘 이른 조각부터 가져간다.** 그래야 상한·멈춤에서 «여기까지는 빈틈없이 찾았다» 를 말할 수 있다.

import type { PastCursor } from '../api/pastXLog';
import type { SearchXLogFilter, WidePage } from '../api/scouterApi';
import { yyyymmdd } from '../types/timeRange';
import type { XLogPack } from '../types/xlog';

/** 다 모아 이만큼이면 멈춘다 — 기본값. 설정 «트랜잭션 찾기 상한» 으로 100만까지 올린다(`clampWideMax`) */
export const WIDE_TOTAL_CAP = 300_000;

/** 조각 폭. 시간당 50만 건 서비스면 4만 건 남짓 — 5,000건 페이지 9개다 */
export const PIECE_MS = 5 * 60_000;

/** 기본 동시 조각 수 — Rust 조회용 연결 풀이 쉬는 연결을 넷까지 들고 있다(`MAX_IDLE_QUERY_CONNS`) */
export const WIDE_PARALLEL = 4;

/** 조각 하나 — 하루 안에 든다 */
export interface Piece {
  /** `yyyymmdd` (이 PC 시간대) */
  date: string;
  s: number;
  e: number;
}

/** 구간을 날짜와 `piece` 폭으로 자른다 — 시간 순, 빈틈·겹침 없이 */
export function planPieces(stime: number, etime: number, piece = PIECE_MS): Piece[] {
  const out: Piece[] = [];
  let s = stime;
  while (s < etime) {
    // 다음 로컬 자정
    const d = new Date(s);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const e = Math.min(s + Math.max(1, piece), midnight, etime);
    out.push({ date: yyyymmdd(s), s, e });
    s = e;
  }
  return out;
}

export interface WideProgress {
  /** 지금까지 모은 건수 (중복 뺀 것) */
  found: number;
  /** 다 훑은 시간의 몫 (0~1) */
  done: number;
  /** 서버에 보낸 요청 수 */
  requests: number;
}

export interface WideResult<T = XLogPack> {
  /** 시간 순 */
  xlogs: T[];
  /**
   * 다 못 찾았을 때 그 까닭.
   *   · `cap`   — 다 모은 것이 상한(`cap`)에 닿아 멈췄다. `stoppedAt` 뒤는 안 훑었다
   *   · `cancelled` — 멈춤을 눌렀다. 모은 것은 다 담는다 — `stoppedAt` 뒤의 것은 일부다
   */
  cut: 'none' | 'cap' | 'cancelled';
  /** `cap`·`cancelled` 일 때 **빈틈없이** 어디까지 훑었나 (epoch ms) */
  stoppedAt: number | null;
  requests: number;
}

export interface WideOptions<T> {
  /** 모두 모을 최대 건수. 설정 «트랜잭션 찾기 상한» (`clampWideMax`) */
  cap?: number;
  /** 한꺼번에 돌릴 조각 수 */
  parallel?: number;
  /** 조각 폭 (테스트용) */
  piece?: number;
  /**
   * 받은 것을 담기 전에 바꾼다(화면 모양으로). **페이지마다 바로 바꾼다** — 다 모은 뒤 바꾸면
   * 수십만 건이 날것과 바꾼 것 두 벌로 한때 메모리에 앉는다.
   */
  map?: (x: XLogPack) => T;
  onProgress?: (p: WideProgress) => void;
  /** 참이면 다음 페이지를 보내기 전에 멈춘다 */
  isCancelled?: () => boolean;
}

/** 한 페이지 찾기 — 테스트에서 갈아 끼운다 (`searchXLogPage`) */
export type PageFn = (
  filter: SearchXLogFilter,
  date: string,
  objHashes: number[],
  cursor: PastCursor | null,
) => Promise<WidePage>;

/** 그날 찾을 오브젝트들 — `objHash` 가 0(전체)이면 그날 붙었던 것 전부 */
export type ObjectsFn = (date: string) => Promise<number[]>;

export async function searchAll<T = XLogPack>(
  filter: SearchXLogFilter,
  page: PageFn,
  objectsOf: ObjectsFn,
  opts: WideOptions<T> = {},
): Promise<WideResult<T>> {
  const cap = opts.cap ?? WIDE_TOTAL_CAP;
  const parallel = Math.max(1, opts.parallel ?? WIDE_PARALLEL);
  const map = opts.map ?? ((x: XLogPack) => x as unknown as T);
  const total = Math.max(1, filter.etime - filter.stime);
  const pieces = planPieces(filter.stime, filter.etime, opts.piece);
  const finished = pieces.map(() => false);

  const seen = new Set<string>();
  const out: { t: number; v: T }[] = [];
  const hashesByDate = new Map<string, Promise<number[]>>();
  let next = 0;
  let doneMs = 0;
  let requests = 0;
  let stop: 'cap' | 'cancelled' | null = null;

  const report = () =>
    opts.onProgress?.({ found: out.length, done: Math.min(1, doneMs / total), requests });

  const hashesOf = (date: string): Promise<number[]> => {
    if (filter.objHash !== 0) return Promise.resolve([filter.objHash]);
    let p = hashesByDate.get(date);
    if (!p) {
      p = objectsOf(date);
      hashesByDate.set(date, p);
    }
    return p;
  };

  /** 조각을 하나씩 가져가 끝까지 받는다 */
  const worker = async () => {
    while (stop === null && next < pieces.length) {
      const i = next++;
      const pc = pieces[i];
      const hashes = await hashesOf(pc.date);
      let cursor: PastCursor | null = null;
      for (;;) {
        if (opts.isCancelled?.()) stop ??= 'cancelled';
        if (stop === 'cancelled') return;
        // 상한에 닿으면 **가장 이른 덜 끝난 조각만** 끝까지 받는다. 다 같이 멈추면 조각 넷이 모두 덜 끝난 채라
        // «빈틈없이 찾은 데» 가 시작 시각이 되어 모은 것을 전부 버린다(트래픽이 많을 때 결과가 비던 까닭)
        if (stop === 'cap' && i !== finished.indexOf(false)) return;
        const res = await page({ ...filter, stime: pc.s, etime: pc.e }, pc.date, hashes, cursor);
        requests++;
        // 조각 경계의 같은 시각은 양쪽에서 다 온다 — txid 로 한 번만 담는다
        for (const x of res.xlogs) {
          if (seen.has(x.txid)) continue;
          seen.add(x.txid);
          out.push({ t: x.end_time, v: map(x) });
        }
        if (res.done) break;
        if (out.length >= cap) {
          stop ??= 'cap';
          report();
          if (i !== finished.indexOf(false)) return;
        }
        cursor = res.cursor;
      }
      finished[i] = true;
      doneMs += pc.e - pc.s;
      report();
      if (out.length >= cap) stop ??= 'cap';
    }
  };

  await Promise.all(Array.from({ length: Math.min(parallel, Math.max(1, pieces.length)) }, worker));

  if (stop === null) return finish('none', null);
  // 처음부터 빈틈없이 끝낸 조각까지
  let stoppedAt = filter.stime;
  for (let i = 0; i < pieces.length && finished[i]; i++) stoppedAt = pieces[i].e;
  return finish(stop, stoppedAt);

  function finish(cut: WideResult<T>['cut'], stoppedAt: number | null): WideResult<T> {
    // 상한이면 **빈틈없이 훑은 데까지만** 담는다 — 그 뒤의 것까지 두면 «어디까지 찾았나» 가 거짓이 된다.
    // 멈춤은 **모은 것을 다** 담는다 — 조각들이 다 덜 끝난 채 멈추면 빈틈없이 훑은 데가 시작 시각이라
    // 모은 것이 다 버려진다. 대신 화면이 «그 시각까지는 빠짐없이, 그 뒤는 일부» 라고 말한다
    const kept = stoppedAt === null || cut === 'cancelled' ? out : out.filter(o => o.t <= stoppedAt);
    kept.sort((a, b) => a.t - b.t);
    return { xlogs: kept.map(o => o.v), cut, stoppedAt, requests };
  }
}

/** 설정 «트랜잭션 찾기 상한» 의 범위. 100만 건이면 화면 모양으로 ≈ 370MB 다 (XLog 버퍼와 같은 건당 크기) */
export const WIDE_MAX_CHOICES = [100_000, 300_000, 500_000, 1_000_000] as const;
export const MIN_WIDE_MAX = 10_000;
export const LIMIT_WIDE_MAX = 1_000_000;

/** 설정에서 온 값을 쓸 수 있는 수로 다듬는다 */
export function clampWideMax(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return WIDE_TOTAL_CAP;
  return Math.min(Math.max(Math.round(n), MIN_WIDE_MAX), LIMIT_WIDE_MAX);
}
