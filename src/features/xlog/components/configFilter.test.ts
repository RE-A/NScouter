import { describe, expect, it } from 'vitest';
import { filterConfig } from './configFilter';
import type { ConfigEntry } from '../types/config';

const entry = (key: string, value: string, def: string): ConfigEntry => ({
  key,
  value,
  default: def,
  changed: value !== def,
});

const ROWS: ConfigEntry[] = [
  entry('net_collector_ip', 'scouter-collector', '127.0.0.1'),
  entry('net_collector_tcp_port', '6100', '6100'),
  entry('profile_sql_enabled', 'false', 'true'),
];

describe('filterConfig', () => {
  it('바뀐 것만 켜면 기본값 그대로인 항목은 빠진다', () => {
    const rows = filterConfig(ROWS, '', true);
    expect(rows.map(r => r.key)).toEqual(['net_collector_ip', 'profile_sql_enabled']);
  });

  it('바뀐 것만 끄면 전부 보인다', () => {
    expect(filterConfig(ROWS, '', false)).toHaveLength(3);
  });

  it('키를 몰라도 값으로 찾을 수 있다', () => {
    const rows = filterConfig(ROWS, '6100', false);
    expect(rows.map(r => r.key)).toEqual(['net_collector_tcp_port']);
  });

  it('기본값으로도 찾는다', () => {
    const rows = filterConfig(ROWS, '127.0.0.1', false);
    expect(rows.map(r => r.key)).toEqual(['net_collector_ip']);
  });

  it('검색어와 바뀐 것만은 함께 걸린다', () => {
    // 6100 은 검색어에는 맞지만 바뀌지 않았다
    expect(filterConfig(ROWS, '6100', true)).toEqual([]);
  });

  it('대소문자를 가리지 않는다', () => {
    expect(filterConfig(ROWS, 'NET_COLLECTOR_IP', false)).toHaveLength(1);
  });
});
