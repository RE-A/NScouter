// 실행 중인 트랜잭션 상세의 표시 값 (순수 로직)
//
// 목록이 "무엇이 몇 초째 돌고 있다"라면 이 화면은 **지금 어디에 멈춰 있나**다.

import type { ThreadDetail } from '../api/scouterApi';

export interface DetailRow {
  label: string;
  value: string;
  /** 값이 없거나 측정되지 않은 줄. 흐리게 표시한다 */
  dim?: boolean;
}

/**
 * `null` 은 0이 아니다.
 *
 * 콜렉터는 JMX 스레드 경합 측정이 꺼져 있으면 **-1** 을 준다(F-46). 그걸 0ms 로 찍으면
 * "경합이 전혀 없었다"는 거짓이 된다 — 실제로는 아무것도 모르는 상태다.
 */
export function measuredMs(v: number | null): string {
  return v === null ? '측정 꺼짐' : `${v.toLocaleString()}ms`;
}

/**
 * 잠금 소유자.
 *
 * 대기 중이 아니면 이름이 비고 id 가 -1(→null)로 온다. "없음"이라고 못 박아 준다 —
 * 빈칸으로 두면 조회에 실패한 것처럼 보인다.
 */
export function lockOwner(d: ThreadDetail): string {
  if (d.lock_owner_id === null && !d.lock_owner_name) return '없음';
  const name = d.lock_owner_name || '(이름 없음)';
  return d.lock_owner_id === null ? name : `${name} (#${d.lock_owner_id})`;
}

/** 상세 표. **비어 있는 줄도 지우지 않는다** — 항목이 사라지면 두 스레드를 나란히 못 읽는다 */
export function detailRows(d: ThreadDetail): DetailRow[] {
  return [
    { label: '스레드', value: `${d.thread_name} (#${d.thread_id})` },
    { label: '상태', value: d.state || '—', dim: !d.state },
    { label: '경과', value: `${d.service_elapsed.toLocaleString()}ms` },
    { label: 'CPU 시간', value: `${d.cpu_time.toLocaleString()}ms` },
    { label: 'User 시간', value: `${d.user_time.toLocaleString()}ms` },
    {
      label: 'Blocked',
      value: `${d.blocked_count.toLocaleString()}회 · ${measuredMs(d.blocked_time)}`,
      dim: d.blocked_time === null,
    },
    {
      label: 'Waited',
      value: `${d.waited_count.toLocaleString()}회 · ${measuredMs(d.waited_time)}`,
      dim: d.waited_time === null,
    },
    { label: '잠금', value: d.lock_name || '없음', dim: !d.lock_name },
    { label: '잠금 소유자', value: lockOwner(d), dim: d.lock_owner_id === null },
    { label: 'txid', value: d.service_txid || '—', dim: !d.service_txid },
  ];
}
