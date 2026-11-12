// 통계 설정 — 판정 기준과 결과 보관 일수
//
// 판정은 화면이 하므로 저장하면 **지난 결과도 바로 다시 판정된다**(다시 돌릴 필요 없다).

import { memo, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { DEFAULT_RULES, type JudgeRules } from './statsJudge';

interface Props {
  rules: JudgeRules;
  keepDays: number;
  onSave: (rules: JudgeRules, keepDays: number) => void;
  onClose: () => void;
}

const inputCls = 'w-24 rounded border border-line-control bg-input px-2 py-1 text-right text-body text-fg';

export const StatsSettingsDialog = memo(function StatsSettingsDialog({ rules, keepDays, onSave, onClose }: Props) {
  // 화면 단위로 들고 있는다 — 에러율 차이는 %p, 호출량은 %
  const [v, setV] = useState({
    slowRatio: String(rules.slowRatio),
    slowMinMs: String(rules.slowMinMs),
    errorRatio: String(rules.errorRatio),
    errorMinPp: String(rules.errorMinDelta * 100),
    volumePct: String(rules.volumeRatio * 100),
    minCount: String(rules.minCount),
    useP99: rules.useP99,
    keepDays: String(keepDays),
  });
  const num = (s: string) => Number(s.trim());
  const ok = (s: string, min: number) => s.trim() !== '' && Number.isFinite(num(s)) && num(s) >= min;
  const valid =
    ok(v.slowRatio, 1) && ok(v.slowMinMs, 0) && ok(v.errorRatio, 1) && ok(v.errorMinPp, 0) && ok(v.volumePct, 1) && ok(v.minCount, 0) && ok(v.keepDays, 0);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const save = () => {
    if (!valid) return;
    onSave(
      {
        slowRatio: num(v.slowRatio),
        slowMinMs: num(v.slowMinMs),
        errorRatio: num(v.errorRatio),
        errorMinDelta: num(v.errorMinPp) / 100,
        volumeRatio: num(v.volumePct) / 100,
        minCount: Math.round(num(v.minCount)),
        useP99: v.useP99,
      },
      Math.round(num(v.keepDays)),
    );
  };
  const reset = () =>
    setV({
      ...v,
      slowRatio: String(DEFAULT_RULES.slowRatio),
      slowMinMs: String(DEFAULT_RULES.slowMinMs),
      errorRatio: String(DEFAULT_RULES.errorRatio),
      errorMinPp: String(DEFAULT_RULES.errorMinDelta * 100),
      volumePct: String(DEFAULT_RULES.volumeRatio * 100),
      minCount: String(DEFAULT_RULES.minCount),
      useP99: DEFAULT_RULES.useP99,
    });

  return (
    <Dialog
      title={t('통계 설정')}
      onClose={onClose}
      widthClass="w-[42rem]"
      footer={
        <>
          <Button size="md" variant="ghost" onClick={reset} className="mr-auto">
            {t('판정 기준 기본값')}
          </Button>
          <Button size="md" onClick={onClose}>
            {t('취소')}
          </Button>
          <Button size="md" variant="primary" onClick={save} disabled={!valid}>
            {t('저장')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-body">
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-fg">{t('판정 기준')}</h3>
          <Row label={t('느려짐')}>
            {t('평균·p90 이 평소의')} <input className={inputCls} value={v.slowRatio} onChange={set('slowRatio')} /> {t('배 이상')},{' '}
            <input className={inputCls} value={v.slowMinMs} onChange={set('slowMinMs')} /> ms {t('이상 늘면')}
          </Row>
          <Row label="">
            <label className="flex items-center gap-2 text-fg-muted">
              <input type="checkbox" checked={v.useP99} onChange={e => setV({ ...v, useP99: e.target.checked })} />
              {t('p99 도 본다 (드문 느린 요청까지 잡는다 — 흔들림이 커서 경보가 늘 수 있다)')}
            </label>
          </Row>
          <Row label={t('에러 증가')}>
            {t('에러율이 평소의')} <input className={inputCls} value={v.errorRatio} onChange={set('errorRatio')} /> {t('배 이상')},{' '}
            <input className={inputCls} value={v.errorMinPp} onChange={set('errorMinPp')} /> %p {t('이상 늘면')}
          </Row>
          <Row label={t('호출량 급변')}>
            TPS ± <input className={inputCls} value={v.volumePct} onChange={set('volumePct')} /> % {t('넘게 변하면')}
          </Row>
          <Row label={t('표본 적음')}>
            {t('한쪽이')} <input className={inputCls} value={v.minCount} onChange={set('minCount')} /> {t('건 미만이면 판정하지 않음')}
          </Row>
          <p className="text-small text-fg-faint">{t('저장하면 지난 결과도 바로 다시 판정합니다.')}</p>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-fg">{t('결과 보관')}</h3>
          <Row label={t('보관 일수')}>
            <input className={inputCls} value={v.keepDays} onChange={set('keepDays')} /> {t('일 — 지난 결과는 목록을 열 때 지웁니다 (0 이면 지우지 않음)')}
          </Row>
        </section>
        {!valid && <p className="text-small text-danger">{t('숫자를 확인하세요 (배수는 1 이상)')}</p>}
      </div>
    </Dialog>
  );
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-small text-fg-dim">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5 text-fg-muted">{children}</div>
    </div>
  );
}
