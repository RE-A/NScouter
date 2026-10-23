// 넓은 구간 찾기 — **서버 상한(기본 500)을 넘어서까지** 찾는다.
//
// 콜렉터는 `req_search_xlog_max_count` 에서 그냥 끊고 «잘렸다» 는 신호를 주지 않는다(F-54).
// 예전에는 닿으면 «구간을 나눠 다시 찾으라» 고만 했다 — 조건 하나만 걸어도 500 은 금방 넘어서
// 사실상 한 시간도 못 찾았다. 사람이 하라던 그 일을 여기서 한다:
//
//   1. 구간 전체를 한 번 찾는다
//   2. 상한에 닿았으면 그 조각을 더 잘게 나눠 **조각마다 다시** 찾는다
//   3. 상한에 안 닿은 조각은 그게 전부다 — 다 모은다
//
// 나누는 크기는 **받은 것이 덮은 시간**으로 짐작한다. 상한에 닿은 결과가 앞쪽 3분을 덮었으면
// 그 구간은 3분에 500건꼴이다 — 그 60% 폭으로 자르면 조각마다 300건 남짓이라 거의 한 번에 끝난다.
// 짐작이 안 서면(시간 순이 아니거나 한 시각에 몰렸으면) 반으로 자른다.
//
// **조각마다 따로 부른다.** 한 번에 다 받아 넘기면 수만 건이 한 덩어리로 IPC 를 탄다(CLAUDE.md 3.3).
// 조각은 많아야 상한(500)건이라 가볍고, 그 사이에 진행을 보여 주고 멈출 수 있다.

import type { SearchMax, SearchXLogFilter, SearchXLogResult } from '../api/scouterApi';
import type { XLogPack } from '../types/xlog';

/** 다 모아 이만큼이면 멈춘다. 목록·메모리가 견디는 선 — 그 너머는 구간을 좁혀 볼 일이다 */
export const WIDE_TOTAL_CAP = 50_000;

/** 이보다 좁은 조각은 더 안 나눈다. 1초에 상한을 넘기는 조건이면 나눠도 끝이 없다 */
export const MIN_PIECE_MS = 1_000;

/** 한 번에 쪼개는 조각 수의 상한 — 짐작이 크게 빗나가도 요청이 폭발하지 않게 */
export const MAX_PIECES_PER_SPLIT = 64;

/** 상한에 닿은 결과를 보고 짐작한 조각 폭의 몫. 1 이면 조각마다 또 상한에 닿기 쉽다 */
const FILL = 0.6;

/**
 * 상한에 닿은 `[s, e]` 를 나눌 조각들 — 시간 순.
 *
 * 더 못 나누면(`MIN_PIECE_MS` 이하) 빈 배열이다.
 */
export function splitRange(
  s: number,
  e: number,
  page: readonly Pick<XLogPack, 'end_time'>[],
): [number, number][] {
  const span = e - s;
  if (span <= MIN_PIECE_MS) return [];

  // 받은 것이 덮은 시간 — 가장 늦은 끝 시각까지
  let last = s;
  for (const x of page) if (x.end_time > last && x.end_time <= e) last = x.end_time;
  const covered = last - s;
  const piece = covered > 0 && covered < span ? Math.max(MIN_PIECE_MS, covered * FILL) : span / 2;

  const n = Math.min(MAX_PIECES_PER_SPLIT, Math.max(2, Math.ceil(span / piece)));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.round(s + (span * i) / n);
    const b = i === n - 1 ? e : Math.round(s + (span * (i + 1)) / n);
    out.push([a, b]);
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

export interface WideResult {
  /** 시간 순 */
  xlogs: XLogPack[];
  limit: SearchMax;
  /**
   * 다 못 찾았을 때 그 까닭.
   *   · `dense` — 1초 조각도 상한에 닿았다. 그 1초 안의 것은 상한만큼만 있다
   *   · `cap`   — 다 모은 것이 `WIDE_TOTAL_CAP` 에 닿아 멈췄다. `stoppedAt` 뒤는 안 훑었다
   *   · `cancelled` — 멈춤을 눌렀다
   */
  cut: 'none' | 'dense' | 'cap' | 'cancelled';
  /** `cap`·`cancelled` 일 때 어디까지 훑었나 (epoch ms) */
  stoppedAt: number | null;
  requests: number;
}

export interface WideOptions {
  cap?: number;
  onProgress?: (p: WideProgress) => void;
  /** 참이면 다음 조각을 부르기 전에 멈춘다 */
  isCancelled?: () => boolean;
}

/** 한 조각 찾기 — 테스트에서 갈아 끼운다 */
export type SearchFn = (filter: SearchXLogFilter, maxHint?: SearchMax) => Promise<SearchXLogResult>;

export async function searchAll(
  filter: SearchXLogFilter,
  search: SearchFn,
  opts: WideOptions = {},
): Promise<WideResult> {
  const cap = opts.cap ?? WIDE_TOTAL_CAP;
  const total = Math.max(1, filter.etime - filter.stime);

  /** 아직 안 훑은 조각들 — 앞이 먼저다 */
  const queue: [number, number][] = [[filter.stime, filter.etime]];
  const seen = new Set<string>();
  const out: XLogPack[] = [];
  let limit: SearchMax | undefined;
  let doneMs = 0;
  let requests = 0;
  let dense = false;

  const report = () =>
    opts.onProgress?.({ found: out.length, done: Math.min(1, doneMs / total), requests });

  while (queue.length > 0) {
    const [s, e] = queue[0];
    if (opts.isCancelled?.()) return finish('cancelled', s);

    const res = await search({ ...filter, stime: s, etime: e }, limit);
    requests += 1;
    limit = { max: res.max, known: res.max_known };
    queue.shift();

    // 상한에 닿았으면 버리고 나눠 다시 — 닿은 결과는 «앞쪽 일부» 라 그대로 쓰면 구멍이 남는다
    if (res.truncated) {
      const pieces = splitRange(s, e, res.xlogs);
      if (pieces.length > 0) {
        queue.unshift(...pieces);
        report();
        continue;
      }
      // 더 못 나누는 1초 조각 — 받은 만큼이라도 담고 «빽빽해서 다 못 찾았다» 고 말한다
      dense = true;
    }

    // 조각 경계의 같은 시각은 양쪽에서 다 온다 — txid 로 한 번만 담는다
    for (const x of res.xlogs) {
      if (seen.has(x.txid)) continue;
      seen.add(x.txid);
      out.push(x);
    }
    doneMs += e - s;
    report();
    if (out.length >= cap) return finish('cap', e);
  }
  return finish(dense ? 'dense' : 'none', null);

  function finish(cut: WideResult['cut'], stoppedAt: number | null): WideResult {
    out.sort((a, b) => a.end_time - b.end_time);
    return {
      // 상한에서 멈춰도 자르지 않는다 — 마지막 조각을 반만 담으면 «어디까지 훑었나» 가 거짓이 된다
      xlogs: out,
      limit: limit ?? { max: 0, known: false },
      cut,
      stoppedAt,
      requests,
    };
  }
}
