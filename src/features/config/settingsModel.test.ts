// 설정 화면의 모델 — 살아 있는 항목에 카탈로그를 얹는 규칙
//
// 지키는 것:
//   · 항목은 **서버가 준 것만** 띄운다 — 카탈로그만 보고 만들면 판이 달라 먹지 않는 설정을 고친다
//   · 카탈로그에 없는 항목도 버리지 않는다 — «기타» 로 모은다
//   · 예시 항목(`$measurement$`)은 실제 키에 대 본다
//   · 내부 항목(`_`)은 접어 두되, 기본값과 다르면 늘 보인다

import { describe, expect, it } from 'vitest';
import { buildSections, isVisible, matchesSetting, scopeOfObjType, toItem } from './settingsModel';
import type { ConfigEntry } from '../xlog/types/config';

function entry(key: string, value = '', dflt = value, desc = ''): ConfigEntry {
  return { key, value, default: dflt, changed: value !== dflt, desc, value_type: 0 };
}

const NONE = { query: '', changedOnly: false, showInternal: false, editing: new Set<string>() };

describe('toItem', () => {
  it('공식 항목에 한국어 이름과 공식 원문을 얹는다', () => {
    const it0 = toItem('java', entry('net_collector_ip', '10.0.0.5', '127.0.0.1'));
    expect(it0.label).toBe('콜렉터 IP');
    expect(it0.officialDesc).toBe('Collector IP');
    expect(it0.sectionId).toBe('network');
    expect(it0.documented).toBe(true);
  });

  it('공식 문서에 없는 항목은 키를 이름으로 쓰고 «기타» 에 둔다', () => {
    // 버리면 플러그인이 쓰는 설정이나 문서 이후에 생긴 설정을 이 화면에서 못 고친다.
    const it0 = toItem('java', entry('my_plugin_option', 'x', 'x', 'from agent'));
    expect(it0.label).toBe('my_plugin_option');
    expect(it0.sectionId).toBe('other');
    expect(it0.officialDesc).toBe('from agent'); // 에이전트가 준 설명이라도 붙인다
    expect(it0.documented).toBe(false);
  });

  it('예시 항목(`$measurement$`)에 실제 키를 대 본다', () => {
    // 공식 문서는 «이 항목은 예시일 뿐, $measurement$ 를 실제 이름으로 바꿔 쓰라» 고 적는다.
    const it0 = toItem('server', entry('input_telegraf_cpu_enabled', 'true'));
    expect(it0.label).toBe('Telegraf 측정값 입력 사용');
    expect(it0.template).toBe(true);
    expect(it0.sectionId).toBe('request');
  });

  it('예시 항목은 가운데를 비울 수 없다', () => {
    // `input_telegraf__enabled` 는 측정값 이름이 없는 키다 — 예시에 걸리면 안 된다.
    expect(toItem('server', entry('input_telegraf__enabled')).documented).toBe(false);
  });

  it('내부 항목과 사용 안 함 항목을 가른다', () => {
    expect(toItem('server', entry('_trace')).internal).toBe(true);
    expect(toItem('server', entry('input_telegraf_enabled')).deprecated).toBe(true);
    expect(toItem('server', entry('net_tcp_listen_port')).deprecated).toBe(false);
  });

  it('공식 설명에 «restart required» 가 있으면 재시작 필요로 표시한다', () => {
    // 문서가 말한 것만 — 짐작으로 붙이지 않는다.
    expect(toItem('server', entry('_mgr_text_db_index_default_mb', '1')).restartRequired).toBe(true);
    expect(toItem('server', entry('ext_link_url_pattern')).restartRequired).toBe(true);
    expect(toItem('server', entry('net_tcp_listen_port', '6100')).restartRequired).toBe(false);
  });

  it('공식 설명이 없는 항목은 공식 원문이 빈다', () => {
    // 화면이 «공식 설명 없음» 이라고 적는다 — 없는 설명을 만들어 내지 않는다.
    expect(toItem('server', entry('_trace')).officialDesc).toBe('');
  });
});

describe('buildSections', () => {
  it('카탈로그의 구역 순서를 따르고 빈 구역은 뺀다', () => {
    const s = buildSections('java', [
      entry('log_keep_days', '7'),
      entry('net_collector_ip', '127.0.0.1'),
      entry('unknown_x'),
    ]);
    expect(s.map(x => x.def.id)).toEqual(['network', 'log', 'other']);
  });

  it('구역 안은 공식 문서 순서다', () => {
    // 문서가 관련 항목을 붙여 적어 두었다 — 샘플링 1·2·3 구간이 이름순이면 흩어진다.
    const s = buildSections('java', [
      entry('xlog_sampling_step3_ms', '3000'),
      entry('xlog_sampling_enabled', 'false'),
      entry('xlog_sampling_step1_ms', '100'),
    ]);
    expect(s[0].items.map(i => i.entry.key)).toEqual([
      'xlog_sampling_enabled',
      'xlog_sampling_step1_ms',
      'xlog_sampling_step3_ms',
    ]);
  });

  it('서버 로그 항목은 «로그» 구역으로 간다', () => {
    // 공식 문서의 서버 설정은 로그 항목이 첫 구역 주석보다 위에 있어 구역 이름이 없다.
    const s = buildSections('server', [entry('log_keep_days', '31')]);
    expect(s[0].def.label).toBe('로그');
  });
});

describe('matchesSetting', () => {
  const item = toItem('java', entry('net_collector_tcp_so_timeout_ms', '60000'));

  it('한국어 이름으로 찾는다', () => {
    expect(matchesSetting(item, '콜렉터 타임아웃')).toBe(true);
  });

  it('공식 영어 원문으로도 찾는다', () => {
    expect(matchesSetting(item, 'socket timeout')).toBe(true);
  });

  it('키와 값으로도 찾는다', () => {
    expect(matchesSetting(item, 'net_collector')).toBe(true);
    expect(matchesSetting(item, '60000')).toBe(true);
  });

  it('낱말 하나라도 없으면 안 걸린다', () => {
    expect(matchesSetting(item, '콜렉터 디스크')).toBe(false);
  });
});

describe('isVisible', () => {
  it('내부 항목은 접어 둔다', () => {
    expect(isVisible(toItem('server', entry('_trace', 'false')), NONE)).toBe(false);
    expect(isVisible(toItem('server', entry('_trace', 'false')), { ...NONE, showInternal: true })).toBe(true);
  });

  it('내부 항목이라도 기본값과 다르면 보인다', () => {
    // 누군가 바꿔 둔 설정을 «내부» 라는 이유로 가리면 동작이 왜 다른지 찾을 수 없다.
    expect(isVisible(toItem('server', entry('_trace', 'true', 'false')), NONE)).toBe(true);
  });

  it('고치고 있는 항목은 조건과 무관하게 남긴다', () => {
    const item = toItem('java', entry('net_collector_ip', '127.0.0.1'));
    const o = { ...NONE, changedOnly: true, query: '없는말', editing: new Set(['net_collector_ip']) };
    expect(isVisible(item, o)).toBe(true);
  });
});

describe('scopeOfObjType', () => {
  it('호스트 에이전트와 자바 에이전트를 가른다', () => {
    expect(scopeOfObjType('linux')).toBe('host');
    expect(scopeOfObjType('tomcat')).toBe('java');
    // 처음 보는 종류는 자바 에이전트 설정으로 본다 — 이름이 다르면 «기타» 로 모인다
    expect(scopeOfObjType('CJFW')).toBe('java');
  });
});
