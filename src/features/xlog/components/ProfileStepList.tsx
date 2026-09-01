// src/features/xlog/components/ProfileStepList.tsx
// XLog 프로파일 Step — 시간축 정렬 목록
//
// 설계 의도: 사용자가 프로파일을 여는 이유는 **"1866ms 가 어디로 갔나"** 하나다.
// 그래서 스텝을 나열만 하지 않고 트랜잭션 시간축 위에 얹는다.
// 막대 사이의 빈 구간 = 어떤 스텝도 설명 못 한 시간이라 그 자체가 단서다.
//
// 이전 버전은 행마다 배경색을 채워(정상/에러/API/기타 4종) 세로로 색띠가 쌓였다.
// 색은 **데이터에만** 쓰고 행 구분은 hairline 으로 한다.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProfileStep } from '../types/profile';
import { stepDepth, waterfallGeometry } from './stepLayout';
import { durationBar, durationTone } from './durationTone';
import { ErrorDetail } from './ErrorDetail';
import { bindSql } from './sqlBind';
import { affectedRows } from './sqlAffected';
import { formatSql } from './sqlFormat';
import { useViewOptions } from '../hooks/useViewOptions';
import { t } from '../../../i18n';

interface ProfileStepListProps {
  steps: ProfileStep[];
  texts: Record<number, string>;
  /** 트랜잭션 총 소요 시간(ms). 막대 비율의 기준 */
  totalElapsed: number;
  /**
   * 스레드로 넘어간 지점을 눌렀을 때 (ThreadProfile).
   *
   * 없으면 링크로 만들지 않는다 — 눌러도 아무 일 없는 링크는 없느니만 못하다.
   */
  onOpenThread?: (txid: string) => void;
  /**
   * 검색으로 걸린 스텝의 순번. 그 줄을 강조하고 화면 안으로 데려온다.
   *
   * **스텝은 수백 개다.** "이 트랜잭션이 걸렸다"까지만 알려주고 어디서 걸렸는지
   * 안 짚어 주면 목록을 처음부터 훑어야 한다.
   */
  highlightIndex?: number | null;
}

/** 스텝 종류별 표기 — 채운 배지 대신 글자색으로 구분한다 */
const KIND = {
  Method: { label: 'M', cls: 'text-[var(--cat-method)]' },
  Sql: { label: 'SQL', cls: 'text-[var(--cat-sql)]' },
  ApiCall: { label: 'API', cls: 'text-[var(--cat-api)]' },
  Message: { label: '·', cls: 'text-fg-faint' },
  Socket: { label: 'SCK', cls: 'text-[var(--cat-socket)]' },
  ThreadCall: { label: 'THR', cls: 'text-[var(--cat-api)]' },
} as const;

export const ProfileStepList = memo(function ProfileStepList({
  steps,
  texts,
  totalElapsed,
  onOpenThread,
  highlightIndex = null,
}: ProfileStepListProps) {
  const options = useViewOptions();
  const visible = steps.filter(s => s.kind !== 'Unknown');
  if (visible.length === 0) {
    return <p className="px-2 py-6 text-center text-body text-fg-faint">{t('스텝이 없습니다')}</p>;
  }

  const parents = steps.map(s => (s.kind === 'Unknown' ? -1 : s.parent));

  return (
    <ol className="divide-y divide-line/60">
      {steps.map((step, i) =>
        step.kind === 'Unknown' ? null : (
          <StepRow
            key={i}
            step={step}
            depth={stepDepth(parents, i)}
            texts={texts}
            total={totalElapsed}
            onOpenThread={onOpenThread}
            highlighted={i === highlightIndex}
            sqlBindInline={options.sqlBindInline}
          />
        ),
      )}
    </ol>
  );
});

function StepRow({
  step,
  depth,
  texts,
  total,
  onOpenThread,
  highlighted,
  sqlBindInline,
}: {
  step: Exclude<ProfileStep, { kind: 'Unknown' }>;
  depth: number;
  texts: Record<number, string>;
  total: number;
  onOpenThread?: (txid: string) => void;
  highlighted: boolean;
  sqlBindInline: boolean;
}) {
  const text = (hash: number) => texts[hash] ?? `0x${(hash >>> 0).toString(16)}`;

  let label = '';
  let detail: string | null = null;
  let elapsed = 0;
  let errorHash = 0;

  switch (step.kind) {
    case 'Method':
      label = text(step.hash);
      elapsed = step.elapsed;
      break;
    case 'Sql':
      label = 'query';
      // 본문은 SqlBody 가 그린다 — 채우기·접기를 여기서 하면 다른 종류까지 얽힌다.
      detail = null;
      elapsed = step.elapsed;
      errorHash = step.error;
      break;
    case 'ApiCall':
      label = step.address || text(step.hash);
      detail = step.address ? text(step.hash) : null;
      elapsed = step.elapsed;
      errorHash = step.error;
      break;
    case 'Message':
      label = step.message || (step.hash !== 0 ? text(step.hash) : '');
      break;
    case 'Socket':
      label = `${step.ipaddr}:${step.port}`;
      elapsed = step.elapsed;
      errorHash = step.error;
      break;
    case 'ThreadCall':
      label = text(step.hash);
      elapsed = step.elapsed;
      break;
  }

  // 실제로 스레드가 떴고 txid 가 있을 때만 열 수 있다.
  // threaded=false 면 따라가 봐야 빈 프로파일이다.
  const threadTxid =
    step.kind === 'ThreadCall' && step.threaded && step.txid !== '0' ? step.txid : null;

  const kind = KIND[step.kind];
  const { leftPct, widthPct } = waterfallGeometry(step.start_time, elapsed, total);
  const failed = errorHash !== 0;

  /**
   * 걸린 줄로 화면을 옮긴다.
   *
   * **강조만 하면 소용이 없다** — 스텝이 수백 개면 그 줄이 스크롤 밖에 있다.
   * jsdom 에는 scrollIntoView 가 없으므로 있을 때만 부른다.
   */
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!highlighted) return;
    rowRef.current?.scrollIntoView?.({ block: 'center' });
  }, [highlighted]);

  return (
    <li
      ref={rowRef}
      className={[
        'grid grid-cols-[34px_28px_minmax(0,1fr)_84px] items-baseline gap-x-2',
        'px-2 py-1 hover:bg-hover/60',
        // 강조는 **테두리**로 한다. 배경으로 하면 에러 행의 bg-danger 와 같은 종류가 겹쳐
        // 어느 쪽이 이길지가 CSS 생성 순서에 달린다 — 눈으로 보고서야 아는 버그가 된다.
        highlighted ? 'ring-1 ring-inset ring-accent' : '',
        failed
          ? 'border-l-2 border-danger bg-danger/5'
          : `border-l-2 border-transparent ${highlighted ? 'bg-accent/12' : ''}`,
      ].join(' ')}
    >
      {/* 시작 시각 — 트랜잭션 시작 기준 상대 ms */}
      <span className="tnum text-right font-mono text-micro text-fg-faint">
        {step.start_time}
      </span>

      {/* 종류 */}
      <span className={`font-mono text-micro font-semibold ${kind.cls}`}>{kind.label}</span>

      {/* 내용 */}
      <div style={{ paddingLeft: depth * 10 }} className="min-w-0">
        {threadTxid && onOpenThread ? (
          <button
            onClick={() => onOpenThread(threadTxid)}
            title={`${t('이 스레드로 이어진 작업을 엽니다')} — ${label}`}
            className="block max-w-full truncate text-left text-small text-accent underline decoration-dotted underline-offset-2 hover:bg-hover"
          >
            {label}
          </button>
        ) : (
          <span
            className={`block truncate text-small ${
              step.kind === 'Message' ? 'text-fg-muted' : 'text-fg'
            }`}
            title={label}
          >
            {label}
          </span>
        )}
        {detail && (
          // 긴 SQL 이 행을 무한히 밀어내지 않게 4줄에서 자른다.
          // 전문은 title 로 볼 수 있고, 필요하면 행을 넓히면 된다.
          // `block` 을 빼야 line-clamp 가 듣는다 (위 SqlBody 주석 참고).
          <code
            title={detail}
            className="mt-0.5 line-clamp-4 break-all whitespace-pre-wrap font-mono text-micro text-fg-muted"
          >
            {detail}
          </code>
        )}
        {step.kind === 'Sql' && (
          <SqlBody
            sql={text(step.hash)}
            params={step.param}
            inline={sqlBindInline}
            updated={step.updated}
          />
        )}
        {failed && <ErrorDetail text={text(errorHash)} compact />}
      </div>

      {/* 시간축 위의 막대 + 소요 시간 */}
      <div className="flex flex-col items-end gap-0.5">
        <span className={`tnum font-mono text-micro ${durationTone(elapsed)}`}>
          {elapsed > 0 ? `${elapsed}ms` : ''}
        </span>
        <div className="relative h-[3px] w-full rounded-full bg-line">
          <div
            className={`absolute h-full rounded-full ${durationBar(elapsed)}`}
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
        </div>
      </div>
    </li>
  );
}


// 접기는 `line-clamp-3` 을 **리터럴로** 쓴다 — Tailwind 는 소스에 그대로 적힌 클래스만
// 만들어 낸다. 템플릿으로 조립하면 CSS 가 없어 조용히 안 접힌다.

/**
 * SQL 본문.
 *
 * 두 가지를 여기서 정한다:
 *   1. **바인딩 값을 문장에 채울지** (설정). `where id=?` 만으로는 무슨 값으로
 *      느렸는지 알 수 없고 복사해 실행할 수도 없다.
 *   2. **긴 문장을 접을지.** 한 줄짜리 SELECT 도 컬럼을 다 적으면 수백 자다 —
 *      안 접으면 스텝 하나가 화면을 다 먹는다.
 */
/**
 * 에이전트가 SQL 문장을 못 얻었을 때 **텍스트 자리에 그대로 넣어 보내는 말**.
 *
 * 실제 문장이 아니다. 그대로 뿌리면 «unknown 이라는 쿼리를 실행했다» 로 읽힌다.
 * 실측(F-53): `TraceSQL0.start(stmt, param, xtype)` 에서 `param == null` 이면
 * `sql = "unknown"` 을 그대로 `sendSqlText` 로 보낸다.
 */
const AGENT_UNKNOWN_SQL = 'unknown';

/**
 * 몇 행을 바꿨는가.
 *
 * **문장을 잃었을 때 남는 유일한 단서다.** `unknown` 옆에 «1행» 이 있으면
 * 적어도 읽기가 아니라 쓰기였다는 것은 알 수 있다.
 *
 * **정확한 행 수라고 단정하지 않는다 (F-55).** 에이전트가 `getUpdateCount()` 를
 * 직전 스텝에 누적해서, 같은 연결로 UPDATE 를 잇달아 하면 부풀려진다
 * (1행짜리가 «2행» 으로 온다). 그 뜻을 툴팁이 적는다.
 */
function Affected({ updated }: { updated: number }) {
  const a = affectedRows(updated);
  if (a === null) return null;
  return (
    <span
      className="ml-1 shrink-0 font-mono text-micro text-fg-faint"
      title={t('에이전트가 보고한 갱신 건수입니다. 같은 연결로 여러 번 갱신하면 앞 문장에 얹혀 실제보다 크게 나올 수 있습니다.')}
    >
      {a.kind === 'rows' ? `~${a.count}${t('행')}` : t('바꾼 행 수 모름')}
    </span>
  );
}

/**
 * 눌러서 클립보드로. 복사했다는 것을 **버튼 자신이** 잠깐 말한다.
 *
 * 토스트를 띄우지 않는 이유: 프로파일 한 판에 스텝이 수백 개라 어느 줄에서 눌렀는지가
 * 중요한데, 화면 한가운데 뜨는 알림은 그걸 말해 주지 못한다.
 */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(id);
  }, [done]);

  return (
    <button
      type="button"
      onClick={e => {
        // 행 클릭(상세 열기)까지 번지면 복사하려다 다른 창이 뜬다.
        e.stopPropagation();
        // 클립보드는 거절될 수 있다(권한·포커스). 실패하면 조용히 둔다 —
        // 여기서 에러를 띄우면 프로파일 읽기가 끊긴다.
        void navigator.clipboard?.writeText(text).then(() => setDone(true)).catch(() => {});
      }}
      title={t('이 문장을 클립보드로 복사합니다')}
      className="mt-0.5 rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
    >
      {done ? t('복사됨') : t('복사')}
    </button>
  );
}

function SqlBody({
  sql,
  params,
  inline,
  updated,
}: {
  sql: string;
  params: string;
  inline: boolean;
  /** 몇 행을 바꿨는가 (`SqlStep3.updated`) */
  updated: number;
}) {
  const [expanded, setExpanded] = useState(false);
  /**
   * 접힌 상태에서 실제로 넘쳤는가.
   *
   * **글자 수로 정하면 안 된다.** 상세 패널은 폭을 끌어 바꿀 수 있어서, 같은 문장도
   * 좁으면 아홉 줄이고 넓으면 두 줄이다 — 실제로 158자짜리 SELECT 가 9줄로 깔렸는데
   * 임계값(180자) 아래라 «펼치기»가 안 나왔다. 재서 판단한다.
   */
  const [overflows, setOverflows] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const bound = useMemo(
    () => (inline && params !== '' ? bindSql(sql, params) : null),
    [inline, params, sql],
  );

  const filled = bound ? bound.text : sql;
  /**
   * **펼쳤을 때만 줄로 나눈다.**
   *
   * 접힌 상태는 세 줄뿐이라, 정렬하면 `select` · `from` · `where` 세 낱말만 보이고
   * 정작 무슨 표를 읽는지가 안 보인다. 접혔을 때는 한 줄에 최대한 담는 편이 낫다.
   * 펼치는 이유는 «문장을 읽으려는 것» 이므로 그때 나눈다.
   */
  const shown = expanded ? formatSql(filled) : filled;
  const mismatched = bound !== null && (bound.bound < bound.placeholders || bound.leftover.length > 0);

  useLayoutEffect(() => {
    // 펼친 뒤에는 넘치지 않으므로 재지 않는다 — 재면 «접기» 버튼이 사라진다.
    if (expanded) return;
    const el = codeRef.current;
    if (!el) return;

    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();

    // 패널 폭이 바뀌면 줄 수가 달라진다. 안 다시 재면 넘치는데 펼칠 방법이 없어진다.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown, expanded]);

  // **문장이 아닌 것을 문장처럼 보여주지 않는다.** 에이전트가 SQL 을 못 얻으면
  // 텍스트 자리에 `unknown` 이라는 말을 넣어 보낸다 — 그대로 뿌리면 그런 쿼리를
  // 실행한 것으로 읽힌다. 무엇이 없는지, 왜 없는지 말해 주는 편이 낫다.
  if (sql === AGENT_UNKNOWN_SQL) {
    return (
      <p className="mt-0.5 text-micro">
        <span
          className="text-warn"
          title={t('자동 생성 키를 쓰는 INSERT 는 에이전트가 문장을 얻지 못합니다. 드라이버가 문장 없이 PreparedStatement 를 만들기 때문이고, 콜렉터까지 문장이 오지 않아 화면에서 복원할 수 없습니다.')}
        >
          {t('에이전트가 SQL 문장을 받지 못했습니다')}
        </span>
        <Affected updated={updated} />
      </p>
    );
  }

  return (
    <div className="mt-0.5">
      {/* **`block` 과 `line-clamp` 를 같이 쓰면 안 된다.** 둘 다 display 를 정하는데
          line-clamp 는 `-webkit-box` 를 써야 동작한다 — `block` 이 이기면 아무 일도 없다.
          (이 파일의 기존 `line-clamp-4` 도 같은 이유로 내내 안 먹고 있었다.) */}
      <code
        ref={codeRef}
        title={filled}
        className={`break-all whitespace-pre-wrap font-mono text-micro text-fg-muted ${
          expanded ? 'block' : 'line-clamp-3'
        }`}
      >
        {shown}
      </code>

      <div className="flex items-baseline">
        {overflows && (
          <button
            type="button"
            // 행 클릭(상세 열기)까지 번지면 접으려다 다른 창이 뜬다.
            onClick={e => {
              e.stopPropagation();
              setExpanded(v => !v);
            }}
            className="mt-0.5 rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
          >
            {expanded ? t('접기') : `${t('펼치기')} (${filled.length.toLocaleString()}${t('자')})`}
          </button>
        )}
        {/* **채운 문장을 복사한다.** 이 화면을 여는 이유의 절반은 «이 쿼리를 DB 에 붙여
            돌려 보는 것» 이다. 값이 들어간 문장이라 그대로 실행된다.
            펼침 여부와 무관하게 **전문**을 복사한다 — 접혀 있다고 세 줄만 주면 안 된다. */}
        <CopyButton text={filled} />
        <Affected updated={updated} />
      </div>

      {/* 채우지 않는 설정이면 값은 따로 보여준다 — 안 보여주면 정보가 사라진다.
          **채웠더라도 아귀가 안 맞으면 원본을 같이 보여준다.** 자리와 값의 수가 다르면
          어느 값이 어디로 갔는지가 곧 의심 대상인데, 채운 문장만 보여 주면 확인할
          방법이 없다 — 온 값 그대로가 유일한 근거다. */}
      {params !== '' && (!inline || mismatched) && (
        <code className="mt-0.5 block break-all font-mono text-micro text-fg-dim" title={params}>
          <span className="text-fg-faint">{t('바인딩')}</span> {params}
        </code>
      )}

      {/* **채우다 만 것을 조용히 두면 안 된다.** 값이 모자라거나 남은 건
          SQL 이 잘렸거나 파라미터를 잘못 자른 신호다. */}
      {bound && bound.bound < bound.placeholders && (
        <span
          className="mt-0.5 block text-micro text-warn"
          title={t('에이전트는 setXxx 로 넘어온 값만 기록합니다. 프로시저의 OUT 파라미터처럼 넣은 값이 없는 자리는 ? 로 남습니다.')}
        >
          {t('자리')} {bound.placeholders}{t('개 중')} {bound.bound}{t('개만 채웠습니다')}
        </span>
      )}
      {bound && bound.leftover.length > 0 && (
        <span className="mt-0.5 block text-micro text-warn" title={bound.leftover.join(', ')}>
          {t('쓰이지 않은 값')} {bound.leftover.length}{t('개:')} {bound.leftover.join(', ')}
        </span>
      )}
    </div>
  );
}
