import { describe, expect, it } from 'vitest';
import { buildPropertyRows, familyOf, formatWakeup } from './objectProperties';
import type { AgentObject } from '../types/xlog';

const obj = (over: Partial<AgentObject> = {}): AgentObject => ({
  obj_hash: -1585387669,
  obj_type: 'tomcat',
  obj_name: '/shop-app/shop-app',
  address: '10.89.2.4',
  version: '2.21.3',
  alive: true,
  wakeup: 1787370497374,
  tags: [],
  ...over,
});

describe('familyOf', () => {
  it('objType 을 Family 로 옮긴다', () => {
    expect(familyOf('tomcat')).toBe('javaee');
    expect(familyOf('linux')).toBe('host');
    expect(familyOf('datasource')).toBe('datasource');
  });

  it('모르는 타입은 지어내지 않는다', () => {
    // 아무 Family 나 붙이면 "이 오브젝트에 TPS 를 물을 수 있다"는 거짓 신호가 된다.
    expect(familyOf('redis')).toBe('알 수 없음');
  });
});

describe('formatWakeup', () => {
  it('0 은 시각이 아니다', () => {
    // epoch 0 을 그리면 1970-01-01 이 찍혀 "아주 오래전에 살아 있었다"가 된다.
    expect(formatWakeup(0)).toBe('—');
  });

  it('밀리초까지 남긴다', () => {
    // 하트비트 간격을 보려고 여는 값이라 초 단위로 자르면 쓸모가 준다.
    expect(formatWakeup(new Date(2026, 7, 22, 13, 4, 5, 7).getTime()))
      .toBe('2026-08-22 13:04:05.007');
  });
});

describe('buildPropertyRows', () => {
  it('ASIS 와 같은 순서로 고정 8줄을 낸다', () => {
    const keys = buildPropertyRows(obj(), '#5b8cff').map(r => r.key);
    expect(keys).toEqual([
      'objectName', 'objectType', 'family', 'address',
      'version', 'alive', 'wakeUp', 'color',
    ]);
  });

  it('tags 를 그대로 뒤에 붙인다', () => {
    // 아는 키만 뽑으면 새 에이전트가 보내는 정보가 조용히 사라진다.
    const rows = buildPropertyRows(
      obj({ tags: [['ADC', 'false'], ['detected', 'tomcat']] }),
      '#5b8cff',
    );
    expect(rows.slice(8).map(r => [r.key, r.value])).toEqual([
      ['ADC', 'false'],
      ['detected', 'tomcat'],
    ]);
    expect(rows.slice(8).every(r => r.fromTags)).toBe(true);
  });

  it('색 줄에만 견본 표시를 단다', () => {
    const rows = buildPropertyRows(obj(), '#5b8cff');
    expect(rows.filter(r => r.isColor).map(r => r.key)).toEqual(['color']);
  });

  it('빈 version 도 줄을 없애지 않는다', () => {
    // datasource 는 version 이 빈 문자열로 온다(실측). 줄이 사라지면
    // "이 오브젝트만 항목이 하나 적다"로 읽혀 표를 비교할 수 없다.
    const rows = buildPropertyRows(obj({ obj_type: 'datasource', version: '' }), '#3dd68c');
    expect(rows.find(r => r.key === 'version')?.value).toBe('');
  });
});
