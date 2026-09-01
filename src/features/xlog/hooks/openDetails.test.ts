// 열어 둔 상세 탭 되살리기의 계약
//
// 여기서 지키려는 것:
//   · 날짜 없는 줄은 버린다 — txid 만으로는 콜렉터가 못 찾는다
//   · 저장본 탭은 담지 않는다 — 파일에서 온 것이라 txid 로 다시 열 수 없다
//   · 탭 수 상한을 넘겨 담지 않는다

import { describe, expect, it } from 'vitest';
import { fromTabs, normalize } from './openDetails';

const toDate = () => '20260902';

describe('normalize', () => {
  it('저장해 둔 것을 그대로 되살린다', () => {
    expect(normalize([{ txid: 'z1', date: '20260902' }], 8)).toEqual([
      { txid: 'z1', date: '20260902' },
    ]);
  });

  it('날짜가 없거나 모양이 틀리면 버린다', () => {
    // 콜렉터는 XLog 를 날짜별로 저장한다. 날짜가 틀리면 에러가 아니라 빈 결과다.
    expect(normalize([{ txid: 'z1' }, { txid: 'z2', date: '2026-09-02' }], 8)).toEqual([]);
  });

  it('같은 txid 는 한 번만', () => {
    const out = normalize(
      [{ txid: 'z1', date: '20260902' }, { txid: 'z1', date: '20260902' }],
      8,
    );
    expect(out).toHaveLength(1);
  });

  it('상한을 넘겨 담지 않는다', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ txid: `z${i}`, date: '20260902' }));
    expect(normalize(many, 8)).toHaveLength(8);
  });

  it('배열이 아니면 빈 목록', () => {
    expect(normalize(null, 8)).toEqual([]);
    expect(normalize('nope', 8)).toEqual([]);
  });
});

describe('fromTabs', () => {
  const tab = (key: string, txid: string | null) => ({
    key,
    state: { xlog: txid === null ? null : { txid, endTime: 1_756_000_000_000 } },
  });

  it('열려 있는 탭을 담는다', () => {
    expect(fromTabs([tab('z1', 'z1'), tab('z2', 'z2')], toDate)).toEqual([
      { txid: 'z1', date: '20260902' },
      { txid: 'z2', date: '20260902' },
    ]);
  });

  it('저장본 탭은 담지 않는다', () => {
    // 파일에서 온 것이라 txid 로 다시 열 수 없다 — 저장본 창이 할 일이다.
    expect(fromTabs([tab('file:z9:1', 'z9'), tab('z1', 'z1')], toDate)).toEqual([
      { txid: 'z1', date: '20260902' },
    ]);
  });

  it('아직 안 열린 탭(xlog 없음)은 건너뛴다', () => {
    expect(fromTabs([tab('z1', null)], toDate)).toEqual([]);
  });
});
