// 자주 쓰는 조회 조건 — 이름 붙여 담아 두기 (순수 로직)
//
// 장애를 볼 때 거는 조건은 매번 새로 짜는 것이 아니라 **몇 벌이 돌아가며 쓰인다** —
// «결제만», «헬스체크 빼고», «3초 넘는 것». 그걸 매번 다시 치는 것이 불편의 실체다.
//
// **담는 것은 «조건» 뿐이다.** 대상 서버(objHashSet)와 실시간/과거 모드는 담지 않는다:
//   · 서버 해시는 콜렉터마다 다르다. 다른 서버에 붙어 불러오면 아무것도 안 걸린다
//   · 모드는 조건이 아니라 «지금 무엇을 보고 있나» 다

import type { PatternRule, XLogFilterState } from '../types/xlog';

/** 담아 두는 조건 한 벌 */
export interface SavedFilter {
  name: string;
  patterns: PatternRule[];
  errorOnly: boolean;
  elapsedMs: number;
  elapsedExclude: boolean;
}

/** 지금 화면의 조건에서 담을 것만 뽑는다 */
export function fromFilter(name: string, filter: XLogFilterState): SavedFilter {
  return {
    name: name.trim(),
    // 빈 줄은 조건이 아니다. 담을 때 털어 둬야 불러온 쪽에서 «왜 한 줄이 비어 있지» 가 없다.
    patterns: filter.patterns.filter(r => r.text.trim() !== ''),
    errorOnly: filter.errorOnly,
    elapsedMs: filter.elapsedMs,
    elapsedExclude: filter.elapsedExclude,
  };
}

/**
 * 불러올 때 화면에 얹을 값.
 *
 * **대상 서버는 건드리지 않는다** — 지금 고른 서버 위에 조건만 갈아 끼운다.
 * 조건을 불러왔다고 보던 서버가 바뀌면 그게 더 놀랍다.
 */
export function toPatch(saved: SavedFilter): Partial<XLogFilterState> {
  return {
    patterns: saved.patterns,
    errorOnly: saved.errorOnly,
    elapsedMs: saved.elapsedMs,
    elapsedExclude: saved.elapsedExclude,
  };
}

/** 설정 파일에서 읽은 것을 쓸 수 있는 모양으로 다듬는다 */
export function normalize(list: unknown): SavedFilter[] {
  if (!Array.isArray(list)) return [];

  const out: SavedFilter[] = [];
  const used = new Set<string>();

  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Partial<SavedFilter>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    // 이름이 곧 고르는 수단이다. 없으면 목록에서 집을 방법이 없다.
    if (name === '' || used.has(name)) continue;

    const rows = Array.isArray(r.patterns) ? r.patterns : [];
    const patterns: PatternRule[] = [];
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const rule = row as Partial<PatternRule>;
      if (rule.field !== 'service' && rule.field !== 'ip') continue;
      const text = typeof rule.text === 'string' ? rule.text : '';
      if (text.trim() === '') continue;
      patterns.push({ field: rule.field, text, exclude: rule.exclude === true });
    }

    const elapsed = Number(r.elapsedMs);
    used.add(name);
    out.push({
      name,
      patterns,
      errorOnly: r.errorOnly === true,
      elapsedMs: Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed) : 0,
      elapsedExclude: r.elapsedExclude === true,
    });
  }
  return out;
}

/**
 * 담는다. 같은 이름이면 **덮어쓴다.**
 *
 * 이름이 겹칠 때 번호를 붙이면 «결제만 (2)» 가 쌓인다 — 대개는 방금 고친 것을
 * 같은 이름으로 다시 담으려는 것이다.
 */
export function upsert(list: readonly SavedFilter[], entry: SavedFilter): SavedFilter[] {
  if (entry.name === '') return [...list];
  const idx = list.findIndex(f => f.name === entry.name);
  if (idx < 0) return [...list, entry];
  return list.map((f, i) => (i === idx ? entry : f));
}

export function remove(list: readonly SavedFilter[], name: string): SavedFilter[] {
  return list.filter(f => f.name !== name);
}

/** 담아 둔 것과 지금 화면의 조건이 같은가 — 목록에서 «지금 이것» 을 표시하는 데 쓴다 */
export function isSame(saved: SavedFilter, filter: XLogFilterState): boolean {
  const now = fromFilter(saved.name, filter);
  if (now.errorOnly !== saved.errorOnly) return false;
  if (now.elapsedMs !== saved.elapsedMs) return false;
  if (now.elapsedExclude !== saved.elapsedExclude) return false;
  if (now.patterns.length !== saved.patterns.length) return false;
  return now.patterns.every((r, i) => {
    const b = saved.patterns[i];
    return r.field === b.field && r.text === b.text && r.exclude === b.exclude;
  });
}
