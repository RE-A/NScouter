import { describe, expect, it } from 'vitest';
import {
  agentRowState,
  groupCheck,
  prunePicked,
  toggleGroupPick,
} from './agentFilter';

describe('agentRowState', () => {
  it('아무도 안 골랐으면 강조하지 않는다', () => {
    // 전 행을 «빠짐» 으로 칠하면 목록이 통째로 죽은 것처럼 보인다.
    expect(agentRowState(new Set(), 11)).toBe('plain');
  });

  it('고른 것과 빠진 것을 가른다', () => {
    const picked = new Set([11]);
    expect(agentRowState(picked, 11)).toBe('picked');
    expect(agentRowState(picked, 22)).toBe('excluded');
  });
});

describe('groupCheck', () => {
  it('하나도 안 골랐으면 none', () => {
    expect(groupCheck(new Set(), [11, 22])).toBe('none');
  });

  it('일부만 골랐으면 some', () => {
    expect(groupCheck(new Set([11]), [11, 22])).toBe('some');
  });

  it('다 골랐으면 all', () => {
    expect(groupCheck(new Set([11, 22]), [11, 22])).toBe('all');
  });

  it('다른 묶음의 선택은 세지 않는다', () => {
    expect(groupCheck(new Set([99]), [11, 22])).toBe('none');
  });

  it('빈 묶음은 none', () => {
    expect(groupCheck(new Set([11]), [])).toBe('none');
  });
});

describe('toggleGroupPick', () => {
  it('안 골랐으면 통째로 켠다', () => {
    // 100대짜리 목록에서 한 대씩 누르게 두지 않으려는 자리다.
    expect([...toggleGroupPick(new Set(), [11, 22])].sort()).toEqual([11, 22]);
  });

  it('다 골랐으면 통째로 끈다', () => {
    expect([...toggleGroupPick(new Set([11, 22]), [11, 22])]).toEqual([]);
  });

  it('일부만 골라 뒀으면 끄지 않고 마저 켠다', () => {
    // 여기서 끄면 애써 고른 몇 대가 사라지고, 무엇을 골랐었는지는 잊는다.
    expect([...toggleGroupPick(new Set([11]), [11, 22])].sort()).toEqual([11, 22]);
  });

  it('다른 묶음의 선택은 건드리지 않는다', () => {
    expect([...toggleGroupPick(new Set([99]), [11, 22])].sort()).toEqual([11, 22, 99]);
  });

  it('원본을 건드리지 않는다', () => {
    const picked = new Set([11]);
    toggleGroupPick(picked, [11, 22]);
    expect([...picked]).toEqual([11]);
  });
});

describe('prunePicked', () => {
  it('사라진 오브젝트를 지운다', () => {
    // 남겨 두면 «3대 골랐는데 화면은 비어 있다» 로 굳는다.
    expect([...prunePicked(new Set([11, 22]), [11])]).toEqual([11]);
  });

  it('바뀐 게 없으면 같은 객체를 돌려준다', () => {
    // 새 Set 을 만들면 리렌더가 끝없이 돈다.
    const picked = new Set([11]);
    expect(prunePicked(picked, [11, 22])).toBe(picked);
  });

  it('빈 선택은 그대로다', () => {
    const picked = new Set<number>();
    expect(prunePicked(picked, [11])).toBe(picked);
  });
});
