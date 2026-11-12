// 조건 묶음 — 대상·서비스·수집 조건·평소 구간 잡는 법을 이름 붙여 남긴다
//
// **구간 시각은 남기지 않는다.** 어제의 «오전 10~11시» 를 그대로 다시 쓸 일은 없다. 대신 평소 구간을
// **현재 구간에서 얼마나 떨어졌나**(시작·끝 차이)로 남겨, 불러오면 지금 넣은 현재 구간에 맞춰 다시 만든다 —
// «지난 7일 같은 시각» 을 담아 두면 어느 날 불러도 그날의 지난 7일이 된다.

import type { StatsRange } from './statsApi';
import type { StatsDraft } from './StatsForm';

export interface StatsPreset {
  name: string;
  targetKind: StatsDraft['targetKind'];
  target: string;
  rule: string;
  ruleName: string;
  services: string;
  serviceInclude: string;
  serviceExclude: string;
  ipInclude: string;
  ipExclude: string;
  raw: boolean;
  /** 평소 구간 — (시작 − 현재 시작, 끝 − 현재 끝) ms */
  baselineOffsets: [number, number][];
}

export function toPreset(name: string, d: StatsDraft): StatsPreset {
  return {
    name: name.trim(),
    targetKind: d.targetKind,
    target: d.target,
    rule: d.rule,
    ruleName: d.ruleName,
    services: d.services,
    serviceInclude: d.serviceInclude,
    serviceExclude: d.serviceExclude,
    ipInclude: d.ipInclude,
    ipExclude: d.ipExclude,
    raw: d.raw,
    baselineOffsets: d.baselines.map(b => [b.stime - d.current.stime, b.etime - d.current.etime]),
  };
}

/** 지금 폼의 현재 구간은 그대로 두고 나머지를 묶음으로 채운다 */
export function applyPreset(d: StatsDraft, p: StatsPreset): StatsDraft {
  const baselines: StatsRange[] = p.baselineOffsets.map(([s, e]) => ({ stime: d.current.stime + s, etime: d.current.etime + e }));
  return {
    ...d,
    targetKind: p.targetKind,
    target: p.target,
    rule: p.rule,
    ruleName: p.ruleName,
    services: p.services,
    serviceInclude: p.serviceInclude,
    serviceExclude: p.serviceExclude,
    ipInclude: p.ipInclude,
    ipExclude: p.ipExclude,
    raw: p.raw,
    baselines,
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** 설정 파일에서 읽은 것 — 사람이 고칠 수 있는 파일이라 모양을 믿지 않는다. 못 쓰는 것은 버린다 */
export function parsePresets(raw: unknown): StatsPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: StatsPreset[] = [];
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue;
    const o = x as Record<string, unknown>;
    const name = str(o.name).trim();
    if (name === '') continue;
    const offs = Array.isArray(o.baselineOffsets)
      ? o.baselineOffsets.filter(
          (v): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n)),
        )
      : [];
    out.push({
      name,
      targetKind: o.targetKind === 'rule' ? 'rule' : 'group',
      target: str(o.target),
      rule: str(o.rule),
      ruleName: str(o.ruleName),
      services: str(o.services),
      serviceInclude: str(o.serviceInclude),
      serviceExclude: str(o.serviceExclude),
      ipInclude: str(o.ipInclude),
      ipExclude: str(o.ipExclude),
      raw: o.raw === true,
      baselineOffsets: offs,
    });
  }
  return out;
}
