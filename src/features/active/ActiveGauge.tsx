// 액티브 게이지 — **화면을 켜자마자 눈에 들어와야 하는 세 가지.**
//
//   지금 몇 건인가 · 그중 느린 것이 얼마나 되나 · 가장 오래된 것은 무엇인가
//
// 세 번째를 빼면 안 된다. 「3초 이상 2건」 은 3초짜리 둘일 수도, 5분짜리 둘일 수도
// 있고 둘은 완전히 다른 상황이다. 단계 막대는 **분포**를, 오른쪽 칸은 **깊이**를 말한다.
//
// 색은 옆 화면(`ActiveServicePanel`)과 같은 세 단계를 쓴다. 같은 앱에서 3초 이상이
// 여기선 주황 저기선 빨강이면 색이 정보가 아니라 장식이 된다.

import { memo } from 'react';
import type { ActiveService } from '../xlog/types/object';
import { formatElapsed, type SpeedStep, type StepCounts } from './activeModel';
import { t } from '../../i18n';

/** 단계별 색·이름. `ActiveServicePanel` 의 STEP 과 같은 값이다 */
const STEP: Record<SpeedStep, { bar: string; text: string; label: string }> = {
  1: { bar: 'bg-accent', text: 'text-accent', label: '1초 미만' },
  2: { bar: 'bg-warn', text: 'text-warn', label: '1~3초' },
  3: { bar: 'bg-danger', text: 'text-danger', label: '3초 이상' },
};

interface ActiveGaugeProps {
  counts: StepCounts;
  /** 가장 오래 붙들고 있는 행. 없으면 한가한 것이다 */
  oldest: ActiveService | null;
  /** 그 행이 어느 서버 것인가 */
  oldestServer: string;
}

export const ActiveGauge = memo(function ActiveGauge({
  counts,
  oldest,
  oldestServer,
}: ActiveGaugeProps) {
  const { total } = counts;
  const worst: SpeedStep | 0 = counts.step3 > 0 ? 3 : counts.step2 > 0 ? 2 : total > 0 ? 1 : 0;

  return (
    <div className="flex items-stretch gap-3">
      {/* 건수 — 이 화면에서 가장 큰 글자 하나. 둘이면 어디를 봐야 할지 모른다 */}
      <div className="flex min-w-[112px] flex-col justify-center rounded border border-line bg-raised px-4 py-3">
        <span
          className={`font-mono text-[32px] leading-none tabular-nums ${
            worst === 0 ? 'text-fg-faint' : STEP[worst].text
          }`}
        >
          {total}
        </span>
        <span className="mt-1.5 text-micro tracking-wide text-fg-dim uppercase">
          {t('실행 중')}
        </span>
      </div>

      {/* 분포 — 합계로 뭉개면 «100건인데 다 빠름» 과 «10건인데 다 멈춤» 이 같아 보인다 */}
      <div className="flex min-w-0 flex-1 flex-col justify-center rounded border border-line bg-raised px-4 py-3">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-base">
          {total === 0 ? (
            <div className="w-full bg-line" />
          ) : (
            ([1, 2, 3] as SpeedStep[]).map(step => {
              const n = step === 1 ? counts.step1 : step === 2 ? counts.step2 : counts.step3;
              if (n === 0) return null;
              return (
                <div
                  key={step}
                  className={`${STEP[step].bar} transition-[width] duration-300`}
                  style={{ width: `${(n / total) * 100}%` }}
                  title={`${t(STEP[step].label)} ${n}${t('건')}`}
                />
              );
            })
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {([1, 2, 3] as SpeedStep[]).map(step => {
            const n = step === 1 ? counts.step1 : step === 2 ? counts.step2 : counts.step3;
            return (
              <span key={step} className="flex items-center gap-1.5 text-micro">
                <span className={`size-2 rounded-full ${STEP[step].bar} ${n === 0 ? 'opacity-25' : ''}`} />
                <span className="text-fg-dim">{t(STEP[step].label)}</span>
                {/* 0인 단계도 자리를 지킨다 — 칸이 사라지면 «줄었다» 가 «없다» 로 읽힌다 */}
                <span className={`font-mono tabular-nums ${n === 0 ? 'text-fg-faint' : 'text-fg'}`}>
                  {n}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* 깊이 — 단계 막대가 말해 주지 않는 것 */}
      <div className="flex min-w-[200px] max-w-[280px] flex-col justify-center rounded border border-line bg-raised px-4 py-3">
        <span className="text-micro tracking-wide text-fg-dim uppercase">{t('가장 오래된 것')}</span>
        {oldest === null ? (
          <span className="mt-1 text-body text-fg-faint">{t('없음')}</span>
        ) : (
          <>
            <span
              className={`mt-0.5 font-mono text-title tabular-nums ${
                STEP[counts.maxElapsed >= 3_000 ? 3 : counts.maxElapsed >= 1_000 ? 2 : 1].text
              }`}
            >
              {formatElapsed(counts.maxElapsed)}
            </span>
            <span className="truncate text-micro text-fg-muted" title={oldest.service}>
              {oldest.service}
            </span>
            <span className="truncate text-micro text-fg-faint" title={oldestServer}>
              {oldestServer}
            </span>
          </>
        )}
      </div>
    </div>
  );
});
