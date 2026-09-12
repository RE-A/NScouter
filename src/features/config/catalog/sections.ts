// 설정 구역 — 화면 왼쪽 목록
//
// 공식 문서의 구역 주석(`//Network`, `//XLog soft sampling options` …)을 **화면에 둘 만한
// 묶음**으로 모은다. 문서 구역을 그대로 쓰면 자바 에이전트만 25개가 넘고, «XLog 샘플링» 이
// 네 구역으로 쪼개져 있어(패턴 샘플링 그룹 2·3·4 …) 한 화면에서 볼 수 없다.
//
// 순서가 곧 화면 순서다. 자주 여는 것(네트워크·오브젝트)을 위에, 드물게 여는 것을 아래에 둔다.

import type { ConfigScope } from './types';

export interface SectionDef {
  id: string;
  /** 화면에 적을 이름 */
  label: string;
  /** 이 묶음에 들어오는 공식 문서 구역들 */
  from: readonly string[];
}

/** 어느 구역에도 안 드는 항목(공식 문서에 없는 항목 포함)이 가는 곳 */
export const OTHER_SECTION: SectionDef = { id: 'other', label: '기타', from: [] };

export const SECTIONS: Record<ConfigScope, readonly SectionDef[]> = {
  server: [
    { id: 'network', label: '네트워크', from: ['Network'] },
    { id: 'dir', label: '디렉터리', from: ['Dir'] },
    { id: 'object', label: '오브젝트', from: ['Object'] },
    { id: 'purge', label: '데이터 보관·삭제', from: ['Manager'] },
    { id: 'db', label: '데이터베이스', from: ['db'] },
    { id: 'compress', label: '압축', from: ['Compress'] },
    { id: 'xlog', label: 'XLog', from: ['XLog', 'Profile', 'Span'] },
    { id: 'request', label: '요청 · Telegraf', from: ['Service request options from client'] },
    { id: 'features', label: '부가 기능', from: ['GeoIP', 'SQL', 'TagCount', 'Visitor Hourly', 'Auto'] },
    { id: 'extlink', label: '외부 UI 연결', from: ['external-link'] },
    // 공식 문서의 서버 설정은 로그 항목이 첫 구역 주석(`//Network`)보다 위에 있다
    { id: 'log', label: '로그', from: ['(구역 없음)'] },
  ],
  java: [
    { id: 'network', label: '네트워크', from: ['Network'] },
    { id: 'object', label: '오브젝트', from: ['Object'] },
    { id: 'trace', label: '추적', from: ['Trace'] },
    { id: 'profile', label: '프로파일', from: ['profile'] },
    { id: 'xlog', label: 'XLog', from: ['XLog', 'XLog error marking', 'XLog discard options'] },
    {
      id: 'sampling',
      label: 'XLog 샘플링',
      from: [
        'XLog hard sampling options',
        'XLog soft sampling options',
        'XLog sampling for service patterns options',
        'XLog patterned sampling options for another sampling group',
      ],
    },
    { id: 'hook', label: '후킹', from: ['Hook'] },
    { id: 'counter', label: '카운터', from: ['Counter'] },
    {
      id: 'dump',
      label: '자동 덤프 · 스택',
      from: [
        'Auto dump options when active service is exceed the set threshold count.',
        'Auto dump options about the thread on stuck',
        'Auto dump options on exceeded process cpu',
        'SFA(Stack Frequency Analyzer)',
        'PSTS(Preiodical Stacktrace Step)',
      ],
    },
    { id: 'control', label: '요청 거절', from: ['Control'] },
    { id: 'alert', label: '알림', from: ['Alert'] },
    { id: 'summary', label: '요약', from: ['Summary'] },
    { id: 'log', label: '로그', from: ['Log'] },
    { id: 'dir', label: '디렉터리 · 관리', from: ['Dir', 'Manager'] },
  ],
  host: [
    { id: 'network', label: '네트워크', from: ['Network'] },
    { id: 'object', label: '오브젝트', from: ['Object'] },
    { id: 'cpu', label: 'CPU 알림', from: ['Cpu'] },
    { id: 'memory', label: '메모리 알림', from: ['Memory'] },
    { id: 'disk', label: '디스크 알림', from: ['Disk'] },
    { id: 'counter', label: '카운터', from: ['Counter'] },
    { id: 'log', label: '로그', from: ['Log', 'Manager'] },
  ],
};
