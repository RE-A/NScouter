// 프로파일 안에서 검색어가 걸린 스텝 찾기 (화면 쪽)
//
// **Rust 의 `profile_search` 와 같은 규칙이다.** 왜 둘로 나뉘어 있나:
//   - Rust: 수백 건을 훑는다. 프로파일을 웹뷰로 옮기지 않으려고 서버에서 돈다.
//   - 여기: 상세를 연 **한 건**만 본다. 그 프로파일과 텍스트는 이미 화면에 있으므로
//     다시 물을 이유가 없다 — 물으면 같은 것을 두 번 받는 셈이다.
//
// 규칙이 갈리면 목록은 "sql 에서 걸림"이라 하는데 상세에서는 아무 데도 강조가 안 되는
// 일이 생긴다. 두 쪽 테스트가 같은 사례를 쓴다.

import type { ProfileStep } from '../types/profile';

export interface StepHit {
  /** 프로파일 안에서의 순번 */
  index: number;
  /** sql / sql-param / apicall / apicall-addr / method / message / socket / error / threadcall */
  kind: string;
}

function has(text: string, needle: string): boolean {
  return text !== '' && text.toLowerCase().includes(needle);
}

/**
 * 걸린 스텝들을 순번 순으로 돌려준다.
 *
 * **한 스텝은 한 번만 센다.** SQL 문과 바인딩 값에 같은 낱말이 있어도 자리는 하나다 —
 * 두 번 세면 "3곳 중 2번째" 같은 안내가 실제와 어긋난다.
 */
export function findStepHits(
  steps: readonly ProfileStep[],
  texts: Record<number, string>,
  query: string,
): StepHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const text = (hash: number): string => texts[hash] ?? '';
  const out: StepHit[] = [];

  steps.forEach((step, index) => {
    switch (step.kind) {
      case 'Method':
        if (has(text(step.hash), needle)) out.push({ index, kind: 'method' });
        break;
      case 'Sql':
        if (has(text(step.hash), needle)) out.push({ index, kind: 'sql' });
        else if (has(step.param, needle)) out.push({ index, kind: 'sql-param' });
        else if (step.error !== 0 && has(text(step.error), needle)) {
          out.push({ index, kind: 'error' });
        }
        break;
      case 'ApiCall':
        if (has(text(step.hash), needle)) out.push({ index, kind: 'apicall' });
        else if (has(step.address, needle)) out.push({ index, kind: 'apicall-addr' });
        else if (step.error !== 0 && has(text(step.error), needle)) {
          out.push({ index, kind: 'error' });
        }
        break;
      case 'Message': {
        // 해시가 0이면 본문이 직접 들어 있다 (MessageStep).
        const body = step.hash !== 0 ? text(step.hash) : step.message;
        if (has(body, needle)) out.push({ index, kind: 'message' });
        break;
      }
      case 'Socket':
        if (has(`${step.ipaddr}:${step.port}`, needle)) out.push({ index, kind: 'socket' });
        break;
      case 'ThreadCall':
        // 이름은 apicall 사전에 있다 (XLogFlowView 와 같다).
        if (has(text(step.hash), needle)) out.push({ index, kind: 'threadcall' });
        break;
      default:
        break;
    }
  });

  return out;
}
