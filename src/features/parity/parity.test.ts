// 이관율 검증
//
// 분모 근거: docs/asis/15-inventory-source-of-truth.md 5.2
// 설계:      docs/test-design.md A절
//
// 이 테스트의 목적은 "얼마나 옮겼나"를 **셀 수 있게** 만드는 것이다.
// 자기신고를 막는 게 핵심이라, implemented 주장에는 반드시 근거 테스트가 있어야 한다.

import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  PARITY_INVENTORY,
  PARITY_GOAL,
  PARITY_RATCHET,
  parityRatio,
  type ParityItem,
} from './inventory';

/** evidence 참조를 실제 파일/테스트명으로 해석한다. */
function resolveEvidence(ref: string): boolean {
  const [layer, target] = ref.split(':');
  switch (layer) {
    case 'L1':
      return existsSync(target);
    case 'L2':
      return grepRust('src-tauri/src', target);
    case 'L3':
      return grepFile('src-tauri/tests/scouter_integration.rs', target);
    case 'L4':
      return grepFile('src-tauri/tests/live_collector.rs', target);
    default:
      return false;
  }
}

function grepFile(path: string, needle: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path, 'utf8').includes(needle);
}

function grepRust(dir: string, needle: string): boolean {
  // L2 는 모듈 내 #[cfg(test)] 이므로 파일을 특정하지 않고 훑는다.
  for (const f of ['codec.rs', 'connection.rs', 'counter.rs', 'value.rs', 'pack.rs']) {
    if (grepFile(`${dir}/scouter/${f}`, needle)) return true;
  }
  return false;
}

const claimed = (i: ParityItem) => i.status === 'implemented' || i.status === 'partial';

describe('이관 인벤토리 무결성', () => {
  it('id 가 중복되지 않는다', () => {
    const ids = PARITY_INVENTORY.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('분모가 15번 문서의 85개와 일치한다', () => {
    expect(PARITY_INVENTORY).toHaveLength(85);
  });

  // 자기신고 금지. 테스트 없이 "됐다"고 표시할 수 없다.
  it('implemented / partial 항목에는 근거 테스트가 있다', () => {
    const missing = PARITY_INVENTORY
      .filter(i => claimed(i) && (!i.evidence || i.evidence.length === 0))
      .map(i => i.id);
    expect(missing).toEqual([]);
  });

  // 죽은 참조 방지. 테스트를 지우거나 이름을 바꾸면 여기서 걸린다.
  it('evidence 에 적힌 테스트가 실제로 존재한다', () => {
    const dead: string[] = [];
    for (const item of PARITY_INVENTORY) {
      for (const ref of item.evidence ?? []) {
        if (!resolveEvidence(ref)) dead.push(`${item.id} -> ${ref}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('out-of-scope 항목에는 사유가 있다', () => {
    const missing = PARITY_INVENTORY
      .filter(i => i.status === 'out-of-scope' && !i.note)
      .map(i => i.id);
    expect(missing).toEqual([]);
  });
});

describe('이관율', () => {
  // 목표(90%)를 처음부터 강제하면 CI 가 계속 빨개서 무뎌진다.
  // 대신 현재 수준(ratchet)을 하한으로 두고, 올라가면 상수를 올린다.
  it(`현재 달성 수준(${(PARITY_RATCHET * 100).toFixed(1)}%) 아래로 내려가지 않는다`, () => {
    expect(parityRatio(PARITY_INVENTORY)).toBeGreaterThanOrEqual(PARITY_RATCHET);
  });

  it('ratchet 상수가 실제 수준보다 뒤처져 있지 않다', () => {
    const actual = parityRatio(PARITY_INVENTORY);
    expect(actual - PARITY_RATCHET).toBeLessThan(0.02);
  });

  it('목표까지 남은 항목 수를 보고한다', () => {
    const ratio = parityRatio(PARITY_INVENTORY);
    const scoped = PARITY_INVENTORY.filter(i => i.status !== 'out-of-scope').length;
    const remaining = Math.ceil((PARITY_GOAL - ratio) * scoped);
    console.log(
      `이관율 ${(ratio * 100).toFixed(1)}% / 목표 ${PARITY_GOAL * 100}% ` +
      `— 대상 ${scoped}개 중 ${remaining > 0 ? `${remaining}개 남음` : '달성'}`,
    );
    expect(ratio).toBeLessThanOrEqual(1);
  });
});
