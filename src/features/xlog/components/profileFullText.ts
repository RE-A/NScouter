// 프로파일 전문 — **붙여 넣을 수 있는 한 덩어리의 글자.**
//
// 화면은 접고 펴고 색을 입히지만, 장애 보고서·메신저·티켓에 들어가는 것은 글자다.
// ASIS 스카우터의 `ProfileTextFull` 이 하던 일이고, 그 모양을 그대로 따른다 —
// 운영자가 이미 그 생김새로 읽을 줄 알기 때문이다. 바꿔서 얻는 것이 없다.
//
// **순수 함수다.** 화면 없이 글자만 보고 고칠 수 있어야 한다.

import type { ProfileStep } from '../types/profile';
import type { SXLog } from '../types/xlog';

/** 들여쓰기 한 단계의 폭. ASIS 와 같다 */
const INDENT = '  ';

/** `HH:mm:ss.SSS` — 날짜는 머리말에 이미 있으므로 표에서는 시각만 쓴다 */
function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** `yyyyMMdd HH:mm:ss.SSS` — 머리말용 */
function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

function num(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * 스텝 한 줄의 «내용».
 *
 * 규칙은 `stepSearch.ts` 와 같아야 한다 — 검색이 걸렸다고 한 자리와 전문에 적히는 글이
 * 다르면, 전문을 받아 본 사람이 그 낱말을 못 찾는다.
 */
export function stepContents(step: ProfileStep, texts: Record<number, string>): string {
  const text = (hash: number): string => texts[hash] ?? `#${hash}`;

  switch (step.kind) {
    case 'Method':
      return text(step.hash);
    case 'Sql': {
      const head = text(step.hash);
      const param = step.param !== '' ? `\n${INDENT}[param] ${step.param}` : '';
      const rows = step.updated > 0 ? ` (${num(step.updated)} rows)` : '';
      const err = step.error !== 0 ? `\n${INDENT}[error] ${text(step.error)}` : '';
      return `${head}${rows}${param}${err}`;
    }
    case 'ApiCall': {
      const head = text(step.hash);
      const addr = step.address !== '' ? ` → ${step.address}` : '';
      const err = step.error !== 0 ? `\n${INDENT}[error] ${text(step.error)}` : '';
      return `${head}${addr}${err}`;
    }
    case 'Message':
      // 해시가 0이면 본문이 직접 들어 있다 (MessageStep).
      return step.hash !== 0 ? text(step.hash) : step.message;
    case 'Socket': {
      const err = step.error !== 0 ? `\n${INDENT}[error] ${text(step.error)}` : '';
      return `socket ${step.ipaddr}:${step.port}${err}`;
    }
    case 'ThreadCall': {
      // 넘어가지 **않은** 자리도 스텝으로 남는다. 그걸 «넘어갔다» 로 적으면 거짓이다.
      const name = text(step.hash);
      return step.threaded ? `${name} → thread txid=${step.txid}` : `${name} (not threaded)`;
    }
    default:
      return `(unknown step type ${step.step_type})`;
  }
}

/** 그 스텝이 걸린 시간(ms). 시간이 없는 종류는 0 이다 */
function elapsedOf(step: ProfileStep): number {
  return 'elapsed' in step ? step.elapsed : 0;
}

interface FullTextInput {
  xlog: SXLog;
  steps: readonly ProfileStep[];
  texts: Record<number, string>;
  /** objHash 를 푼 이름. 없으면 해시를 적는다 */
  objName: string;
  /** service 해시를 푼 이름 */
  serviceName: string;
  /** 스텝 깊이 — 부모를 따라간 값. 화면이 이미 계산해 둔 것을 그대로 받는다 */
  depths: readonly number[];
}

/**
 * 머리말 — 이 트랜잭션이 무엇이었나.
 *
 * **ASIS 의 `►` 를 그대로 쓴다.** 보고서에 붙었을 때 «스카우터에서 뽑은 것» 임이
 * 한눈에 드러나는 표시이고, 받는 쪽이 이미 그렇게 읽는다.
 */
function header(input: FullTextInput): string[] {
  const { xlog, texts, objName, serviceName } = input;
  const out = [
    `► txid    = ${xlog.txid}`,
    `► objName = ${objName}`,
    `► endtime = ${stamp(xlog.endTime)}`,
    `► elapsed = ${num(xlog.elapsed)} ms`,
    `► service = ${serviceName}`,
  ];
  if (xlog.error !== 0) {
    out.push(`► error   = ${texts[xlog.error] ?? `#${xlog.error}`}`);
  }
  out.push(`► ipaddr=${xlog.ipAddr}, cpu=${num(xlog.cpu)} ms, kbytes=${num(xlog.allocKBytes)}`);
  if (xlog.sqlCount > 0) {
    out.push(`► sqlCount=${num(xlog.sqlCount)}, sqlTime=${num(xlog.sqlTime)} ms`);
  }
  if (xlog.apiCallCount > 0) {
    out.push(`► apiCallCount=${num(xlog.apiCallCount)}, apiCallTime=${num(xlog.apiCallTime)} ms`);
  }
  return out;
}

const RULE = '-'.repeat(96);

/**
 * 프로파일 전체를 글자로.
 *
 * 열은 ASIS 와 같다 — `#`(순번) · TIME · T-GAP · CPU · CONTENTS.
 * **T-GAP 은 앞 스텝과의 간격**이라 «어디서 시간이 샜나» 가 바로 읽힌다.
 * 누적 시간만 적으면 그걸 사람이 빼야 한다.
 */
export function profileFullText(input: FullTextInput): string {
  const { xlog, steps, texts, depths } = input;
  const start = xlog.endTime - xlog.elapsed;

  const lines = [
    ...header(input),
    '',
    RULE,
    '    #  TIME           T-GAP     CPU  CONTENTS',
    RULE,
  ];

  if (steps.length === 0) {
    lines.push('', '                    ( 수집된 프로파일이 없습니다 )');
    return lines.join('\n');
  }

  lines.push(`[***] ${clock(start)}        0       0  start transaction`);

  let prevTime = 0;
  let prevCpu = 0;
  steps.forEach((step, i) => {
    const t = 'start_time' in step ? step.start_time : 0;
    const cpu = 'start_cpu' in step ? step.start_cpu : 0;
    const gap = t - prevTime;
    const cpuGap = cpu - prevCpu;
    prevTime = t;
    prevCpu = cpu;

    const indent = INDENT.repeat(depths[i] ?? 0);
    const el = elapsedOf(step);

    // **걸린 시간은 첫 줄에 붙인다.** 맨 끝에 붙이면 SQL 의 `[param]` 이나 `[error]`
    // 뒤에 달라붙어, 그 줄이 얼마 걸렸다는 말처럼 읽힌다.
    const body = stepContents(step, texts).split('\n');
    if (el > 0) body[0] += ` [${num(el)} ms]`;

    // 여러 줄짜리 본문(SQL·에러)도 표 안에 머물러야 한다 — 왼쪽 끝으로 튀어나오면
    // 어느 스텝의 것인지 알 수 없다.
    const wrapped = body.join(`\n${' '.repeat(34)}${indent}`);

    lines.push(
      `[${String(i + 1).padStart(3, '0')}] ${clock(start + t)} ` +
        `${String(num(gap)).padStart(8)} ${String(num(cpuGap)).padStart(7)}  ` +
        `${indent}${wrapped}`,
    );
  });

  lines.push(RULE);
  lines.push(`총 ${num(steps.length)}개 스텝 · ${num(xlog.elapsed)} ms`);
  return lines.join('\n');
}
