import { describe, expect, it } from 'vitest';
import { detailRows, lockOwner, measuredMs } from './threadDetail';
import type { ThreadDetail } from '../api/scouterApi';

const detail = (over: Partial<ThreadDetail> = {}): ThreadDetail => ({
  thread_id: 43,
  thread_name: 'http-nio-8081-exec-8',
  state: 'TIMED_WAITING',
  service_name: '/shop/lab/jitter<GET>',
  service_txid: 'x2hgqrvc7simcd',
  service_elapsed: 1012,
  cpu_time: 4276,
  user_time: 3610,
  blocked_count: 23,
  blocked_time: null,
  waited_count: 2131,
  waited_time: null,
  lock_name: '',
  lock_owner_id: null,
  lock_owner_name: '',
  sql: '',
  sql_bind_var: '',
  subcall: '',
  stack_trace: 'java.lang.Thread.sleep(Native Method)',
  ...over,
});

describe('measuredMs', () => {
  it('null 을 0ms 로 찍지 않는다', () => {
    // 0ms 는 "경합이 전혀 없었다"인데, 실제로는 아무것도 모르는 상태다.
    expect(measuredMs(null)).toBe('측정 꺼짐');
  });

  it('0 은 실제 측정값이다', () => {
    expect(measuredMs(0)).toBe('0ms');
  });

  it('큰 값은 자릿점을 찍는다', () => {
    expect(measuredMs(12345)).toBe('12,345ms');
  });
});

describe('lockOwner', () => {
  it('대기 중이 아니면 없음이라고 말한다', () => {
    // 빈칸으로 두면 조회에 실패한 것처럼 보인다.
    expect(lockOwner(detail())).toBe('없음');
  });

  it('소유자가 있으면 이름과 id 를 함께 낸다', () => {
    expect(lockOwner(detail({ lock_owner_id: 77, lock_owner_name: 'worker-3' })))
      .toBe('worker-3 (#77)');
  });

  it('이름만 있으면 이름만 낸다', () => {
    expect(lockOwner(detail({ lock_owner_name: 'worker-3' }))).toBe('worker-3');
  });
});

describe('detailRows', () => {
  it('측정이 꺼진 줄을 흐리게 표시한다', () => {
    const rows = detailRows(detail());
    const blocked = rows.find(r => r.label === 'Blocked');
    expect(blocked?.value).toBe('23회 · 측정 꺼짐');
    expect(blocked?.dim).toBe(true);
  });

  it('횟수는 시간이 안 잡혀도 실제 값이다', () => {
    // 시간 측정만 꺼져 있다. 횟수까지 감추면 경합 자체를 못 본다.
    expect(detailRows(detail()).find(r => r.label === 'Waited')?.value)
      .toContain('2,131회');
  });

  it('비어 있는 줄도 지우지 않는다', () => {
    // 항목이 사라지면 두 스레드를 나란히 못 읽는다.
    const labels = detailRows(detail({ state: '', lock_name: '' })).map(r => r.label);
    expect(labels).toContain('상태');
    expect(labels).toContain('잠금');
  });

  it('측정된 시간은 흐리게 하지 않는다', () => {
    const rows = detailRows(detail({ blocked_time: 5 }));
    expect(rows.find(r => r.label === 'Blocked')?.dim).toBe(false);
  });
});
