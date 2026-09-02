// 실시간 화면의 **왼쪽 빈 구간** 메우기 — 무엇을 받을지 (순수 함수)
//
// 실시간 스트림은 «지금부터» 를 준다. 그래서 앱을 켠 직후의 차트는 오른쪽 끝에
// 점 한 줄만 있고 나머지 30분이 비어 있다 — 창이 다 찰 때까지 30분을 기다려야
// «평소 대비 지금» 을 볼 수 있다. **볼 수 있는 것은 이미 콜렉터에 있다.**
// 보고 있는 창의 과거 쪽을 뒤늦게라도 받아 채우면, 켜자마자 30분 치를 본다.
//
// 두 가지만 받는다 — 겹치면 같은 트랜잭션이 두 번 그려지고 목록에도 두 번 뜬다:
//   1. 처음 켰을 때(또는 창을 넓혔을 때) **왼쪽으로 모자란 만큼**
//   2. **새로 고른 서버** — 스트림이 그동안 그 서버 것을 주지 않았으므로 창 전체가 비어 있다
// 뺐다 다시 고른 서버는 받지 않는다. 뺀 동안의 구멍은 남지만, 그걸 메우려고 창 전체를
// 다시 받으면 이미 갖고 있는 구간이 통째로 겹친다.

/**
 * 무엇을 채워 봤는가.
 *
 * **«어디까지» 는 담지 않는다.** 그건 저장소가 안다(`oldestEndTime`) — 따로 기억하면
 * 창을 좁혀 prune 이 지운 뒤에도 «채워 뒀다» 고 우기거나, 과거 모드를 다녀와 기억만
 * 지워진 뒤 이미 갖고 있는 구간을 다시 받아 **같은 트랜잭션을 두 번** 그린다.
 * 여기 남는 것은 «이 서버는 한 번 채워 봤다» 뿐이다.
 */
export interface BackfillCoverage {
  hashes: number[];
}

/** 한 번의 과거 조회 */
export interface BackfillJob {
  stime: number;
  etime: number;
  objHashes: number[];
}

export interface BackfillPlan {
  /** 받을 것들. 비어 있으면 할 일이 없다 */
  jobs: BackfillJob[];
  /** 이 계획을 다 받고 나면 갖게 되는 범위 */
  next: BackfillCoverage;
}

/**
 * 이보다 짧은 구멍은 그냥 둔다.
 *
 * 창이 흐르면서 왼쪽 끝은 늘 조금씩 밀린다. 몇 초짜리 구멍마다 조회를 던지면
 * 얻는 것 없이 콜렉터만 두드린다.
 */
export const MIN_BACKFILL_MS = 5_000;

/** 그 날 00:00 (로컬) */
function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export interface BackfillInput {
  now: number;
  /** 지금 보고 있는 창의 길이 */
  timeRangeMs: number;
  /** 지금 보고 있는 대상 */
  hashes: readonly number[];
  /** 지금까지 채운 것. 처음이면 null */
  covered: BackfillCoverage | null;
  /** 저장소에 있는 **가장 오래된 점.** 이 왼쪽이 아직 못 받은 구간이다 */
  oldest: number | null;
}

/**
 * 받을 구간을 고른다.
 *
 * **하루를 넘지 않는다.** 콜렉터는 XLog 를 날짜 디렉토리에 담고 조회도 날짜 단위라
 * (F-18), 자정을 걸친 구간은 한 번에 못 받는다. 자정 직후에는 그날 것만 채우고
 * 어제 몫은 비워 둔다 — 조용히 엉뚱한 날짜를 받아 오는 것보다 낫다.
 */
export function planBackfill(input: BackfillInput): BackfillPlan {
  const { now, timeRangeMs, hashes, covered, oldest } = input;

  const start = Math.max(now - timeRangeMs, dayStart(now));

  if (hashes.length === 0) {
    return { jobs: [], next: covered ?? { hashes: [] } };
  }

  // **처음이면 «새로 고른 서버» 가 없다.** 접속한 뒤로 스트림이 이 서버들 것을 주고
  // 있었으므로, 전부 «보던 서버» 로 놓고 갖고 있는 것 왼쪽만 받는다.
  // 여기서 창 전체를 받으면 스트림이 준 구간과 통째로 겹친다.
  const known = new Set(covered?.hashes ?? []);
  const fresh = covered === null ? [] : hashes.filter(h => !known.has(h));
  const old = covered === null ? [...hashes] : hashes.filter(h => known.has(h));

  const jobs: BackfillJob[] = [];

  // 1. 새로 고른 서버 — 창 전체가 비어 있다.
  //    저장소의 «가장 오래된 점» 은 다른 서버 것이라 이 서버의 경계가 못 된다.
  if (fresh.length > 0 && now - start >= MIN_BACKFILL_MS) {
    jobs.push({ stime: start, etime: now, objHashes: fresh });
  }

  // 2. 보던 서버 — 갖고 있는 것 왼쪽으로 모자란 만큼만.
  const edge = oldest ?? now;
  if (old.length > 0 && edge - start >= MIN_BACKFILL_MS) {
    jobs.push({ stime: start, etime: edge, objHashes: old });
  }

  return { jobs, next: { hashes: [...new Set([...known, ...hashes])] } };
}
