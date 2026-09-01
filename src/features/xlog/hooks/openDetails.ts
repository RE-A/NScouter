// 열어 둔 상세 탭을 껐다 켜도 되살리기 (순수 로직)
//
// **탭은 «보던 자리» 다.** 필터와 배치는 남는데 열어 둔 트랜잭션만 사라지면,
// 다시 켰을 때 어디를 보고 있었는지부터 찾아야 한다.
//
// 다만 트랜잭션은 **콜렉터에서 밀려난다.** 어제 열어 둔 것이 오늘 없을 수 있고,
// 그건 고장이 아니다 — 못 연 것은 조용히 건너뛰되 **몇 개를 못 열었는지는 말한다.**
// 아무 말 없이 사라지면 «복원이 안 되는 앱» 으로 읽힌다.

/** 되살리기에 필요한 최소 정보. 프로파일은 열 때 다시 받는다 */
export interface OpenDetail {
  txid: string;
  /** `yyyyMMdd` — 콜렉터는 XLog 를 날짜별로 저장한다 */
  date: string;
}

/**
 * 저장 파일에서 읽은 목록을 다듬는다.
 *
 * `max` 는 화면이 동시에 열어 두는 탭 수(MAX_DETAIL_TABS)다. 그보다 많이 저장돼 있으면
 * **뒤쪽을 버린다** — 어차피 열자마자 오래된 것부터 닫힌다.
 */
export function normalize(list: unknown, max: number): OpenDetail[] {
  if (!Array.isArray(list)) return [];

  const out: OpenDetail[] = [];
  const seen = new Set<string>();

  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Partial<OpenDetail>;
    const txid = typeof r.txid === 'string' ? r.txid.trim() : '';
    const date = typeof r.date === 'string' ? r.date.trim() : '';
    // 날짜가 없으면 조회할 수 없다. txid 만으로는 콜렉터가 못 찾는다(F-15 와 같은 이유).
    if (txid === '' || !/^\d{8}$/.test(date)) continue;
    if (seen.has(txid)) continue;
    seen.add(txid);
    out.push({ txid, date });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 화면의 탭들을 저장할 모양으로.
 *
 * **저장본 탭(`file:`)은 담지 않는다.** 그건 콜렉터가 아니라 파일에서 온 것이라
 * txid 로 다시 열 수 없다 — 열어야 할 것은 파일이고, 그건 저장본 창이 하는 일이다.
 */
export function fromTabs(
  tabs: readonly { key: string; state: { xlog: { txid: string; endTime: number } | null } }[],
  toDate: (endTime: number) => string,
): OpenDetail[] {
  const out: OpenDetail[] = [];
  for (const tab of tabs) {
    if (tab.key.startsWith('file:')) continue;
    const xlog = tab.state.xlog;
    if (!xlog) continue;
    out.push({ txid: xlog.txid, date: toDate(xlog.endTime) });
  }
  return out;
}
