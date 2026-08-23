// 프로파일 요약 표
//
// 목록이 "언제 무엇이"라면 이 표는 "무엇이 몇 번"이다.
// 정렬 기준이 곧 질문이다 —
//   합계: 시간을 어디서 썼나 · 횟수: 무엇이 반복되나(N+1) · 평균: 한 방이 큰 건 무엇인가

import { memo, useMemo, useState } from 'react';
import type { ProfileStep } from '../types/profile';
import { sortSummary, summarizeSteps, type SummarySort } from './profileSummary';
import { durationTone } from './durationTone';

interface ProfileSummaryTableProps {
  steps: ProfileStep[];
  texts: Record<number, string>;
}

/** 종류 표기 — 목록(ProfileStepList)과 같은 색을 쓴다 */
const KIND_CLS: Record<string, string> = {
  Method: 'text-[var(--cat-method)]',
  Sql: 'text-[var(--cat-sql)]',
  ApiCall: 'text-[var(--cat-api)]',
  Socket: 'text-[var(--cat-socket)]',
  Message: 'text-fg-faint',
  ThreadCall: 'text-[var(--cat-api)]',
};

const KIND_LABEL: Record<string, string> = {
  Method: 'M',
  Sql: 'SQL',
  ApiCall: 'API',
  Socket: 'SCK',
  Message: '·',
  ThreadCall: 'THR',
};

const SORTS: { by: SummarySort; label: string; hint: string }[] = [
  { by: 'sum', label: '합계', hint: '시간을 어디서 썼나' },
  { by: 'count', label: '횟수', hint: '무엇이 반복되나' },
  { by: 'avg', label: '평균', hint: '한 번이 비싼 것' },
];

export const ProfileSummaryTable = memo(function ProfileSummaryTable({
  steps,
  texts,
}: ProfileSummaryTableProps) {
  const [by, setBy] = useState<SummarySort>('sum');

  const rows = useMemo(() => summarizeSteps(steps, texts), [steps, texts]);
  const sorted = useMemo(() => sortSummary(rows, by), [rows, by]);

  if (sorted.length === 0) {
    return <p className="px-2 py-6 text-center text-body text-fg-faint">요약할 스텝이 없습니다</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-1 px-2 pb-1">
        {SORTS.map(s => (
          <button
            key={s.by}
            onClick={() => setBy(s.by)}
            title={s.hint}
            aria-pressed={by === s.by}
            className={`rounded px-1.5 py-0.5 text-micro transition-colors ${
              by === s.by ? 'bg-accent text-white' : 'text-fg-dim hover:bg-hover hover:text-fg-muted'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 열 제목은 한 번만. 값이 숫자라 단위는 제목이 진다 */}
      <div className="grid grid-cols-[28px_minmax(0,1fr)_40px_56px_56px] gap-x-2 border-b border-line px-2 pb-0.5 text-micro text-fg-dim">
        <span />
        <span>내용</span>
        <span className="text-right">횟수</span>
        <span className="text-right">합계</span>
        <span className="text-right">평균</span>
      </div>

      <ol className="divide-y divide-line/60">
        {sorted.map(row => (
          <li
            key={row.key}
            className="grid grid-cols-[28px_minmax(0,1fr)_40px_56px_56px] items-baseline gap-x-2 px-2 py-1 hover:bg-hover/60"
          >
            <span className={`font-mono text-micro font-semibold ${KIND_CLS[row.kind]}`}>
              {KIND_LABEL[row.kind]}
            </span>
            <span className="truncate text-small text-fg" title={row.name}>
              {row.name}
            </span>
            <span className="tnum text-right font-mono text-small text-fg-muted">{row.count}</span>
            <span className={`tnum text-right font-mono text-small ${durationTone(row.sum)}`}>
              {row.sum.toLocaleString()}
            </span>
            <span className="tnum text-right font-mono text-small text-fg-muted">
              {row.avg.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
});
