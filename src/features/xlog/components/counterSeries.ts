// 카운터 차트에 그릴 선을 **받은 원본에서** 만든다 (순수 함수).
//
// 예전에는 받는 순간 접어서(합계면 한 선, 개별이면 오브젝트마다) 쌓았다. 그러면
//   · 개별/합계를 바꿀 때마다 쌓아 둔 것을 버리고 0 부터 다시 쌓아야 했고
//   · 받는 쪽 콜백이 옛 모드를 붙들고 있어 바꿔도 옛 방식으로 쌓이는 일이 있었다
// 원본(한 번의 폴링 = 한 묶음)을 그대로 들고, 그릴 때 접는다.
//
// 접는 방식은 셋이다.
//   · each    — 오브젝트마다 한 선
//   · total   — 고른 것 전부를 한 선 (ASIS RealTimeTotalCount)
//   · service — **서비스마다 한 선.** ECS 에서 Task 4대짜리 서비스 열 개면 개별은 40선이라
//               못 읽고, 합계는 서비스끼리 섞인다. 서비스에 안 속한 오브젝트는 따로 한 선이다

import type { CounterUpdate } from '../types/counter';
import { aggregate, type TotalMode } from './counterTotal';
import { getAgentColor, keyColor } from '../utils/colorPalette';

export type FoldMode = 'each' | 'total' | 'service';

export interface DrawSeries {
  /** 선의 정체. 오브젝트면 `h:해시`, 서비스면 `s:이름`, 합계면 `total` */
  key: string;
  /** 범례에 적을 이름 */
  label: string;
  /** 선 색. `null` 이면 그리는 쪽이 합계 색을 쓴다 */
  color: string | null;
  values: number[];
  times: number[];
  /** 쌍 카운터의 상한 — 가장 최근 것 (F-33). 스칼라 카운터면 null */
  total: number | null;
}

export interface FoldOptions {
  fold: FoldMode;
  /** 접는 셈 (합/평균) — counterTotal.totalMode */
  agg: TotalMode;
  /** 그릴 오브젝트. `null` 이면 전부 */
  visible: ReadonlySet<number> | null;
  /** 오브젝트 → 서비스 이름. 없거나 null 이면 그 오브젝트는 서비스에 안 속한다 */
  serviceOf?: (objHash: number) => string | null;
  /** 오브젝트 → 범례 이름 */
  nameOf: (objHash: number) => string;
}

/**
 * @param updates 오래된 것부터. 한 원소가 한 번의 폴링이다
 */
export function foldSeries(updates: readonly CounterUpdate[], opts: FoldOptions): DrawSeries[] {
  const { fold, agg, visible } = opts;
  const out = new Map<string, DrawSeries>();
  const shown = (h: number) => visible === null || visible.has(h);

  for (const u of updates) {
    const vals = u.values.filter(v => shown(v.obj_hash));
    if (vals.length === 0) continue;

    if (fold === 'each') {
      for (const v of vals) {
        const key = `h:${v.obj_hash}`;
        const s = out.get(key) ?? newSeries(key, opts.nameOf(v.obj_hash), getAgentColor(v.obj_hash));
        out.set(key, s);
        s.values.push(v.value);
        s.times.push(u.time);
        s.total = v.total ?? null;
      }
      continue;
    }

    // 무리마다 모은다 — 합계는 하나, 서비스는 서비스마다 (안 속한 것은 혼자 한 무리)
    const groups = new Map<string, { label: string; color: string | null; vals: typeof vals }>();
    for (const v of vals) {
      let key: string;
      let label: string;
      let color: string | null;
      if (fold === 'total') {
        key = 'total'; label = ''; color = null;
      } else {
        const svc = opts.serviceOf?.(v.obj_hash) ?? null;
        if (svc !== null) { key = `s:${svc}`; label = svc; color = keyColor(svc); }
        else { key = `h:${v.obj_hash}`; label = opts.nameOf(v.obj_hash); color = getAgentColor(v.obj_hash); }
      }
      const g = groups.get(key);
      if (g) g.vals.push(v);
      else groups.set(key, { label, color, vals: [v] });
    }
    for (const [key, g] of groups) {
      const folded = aggregate(g.vals.map(v => v.value), agg);
      if (folded === null) continue;
      const s = out.get(key) ?? newSeries(key, g.label, g.color);
      out.set(key, s);
      s.values.push(folded);
      s.times.push(u.time);
      // 상한도 같은 방식으로 접는다 — 안 그러면 기준선이 한 대 몫만 남는다
      const totals = g.vals.map(v => v.total).filter((t): t is number => typeof t === 'number');
      s.total = aggregate(totals, agg);
    }
  }
  return [...out.values()];
}

function newSeries(key: string, label: string, color: string | null): DrawSeries {
  return { key, label, color, values: [], times: [], total: null };
}

/** 지금 그리고 있는 오브젝트 수 — 머리글의 «N개 에이전트». 가장 최근 폴링 기준 */
export function shownObjectCount(updates: readonly CounterUpdate[], visible: ReadonlySet<number> | null): number {
  const seen = new Set<number>();
  for (const u of updates) for (const v of u.values) if (visible === null || visible.has(v.obj_hash)) seen.add(v.obj_hash);
  return seen.size;
}
