// 통계 설정 — 판정 기준과 결과 보관 일수
//
// 판정은 화면이 하므로 저장하면 **지난 결과도 바로 다시 판정된다**(다시 돌릴 필요 없다).

import { memo, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { DEFAULT_RULES, SLOW_METRICS, type Combine, type JudgeRules } from './statsJudge';
import { slowName } from './statsFormat';
import { termHelp } from './statsGlossary';

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
    slowOn: rules.slowOn,
    beyondWorst: rules.beyondWorst,
    slowUseRatio: rules.slowUseRatio,
    slowUseMs: rules.slowUseMs,
    errorUseRatio: rules.errorUseRatio,
    errorUsePp: rules.errorUsePp,
    slowCombine: rules.slowCombine,
    errorCombine: rules.errorCombine,
    keepDays: String(keepDays),
  });
  const num = (s: string) => Number(s.trim());
  const ok = (s: string, min: number) => s.trim() !== '' && Number.isFinite(num(s)) && num(s) >= min;
  const valid =
    v.slowOn.length > 0 &&
    (v.slowUseRatio || v.slowUseMs) &&
    (v.errorUseRatio || v.errorUsePp) &&
    (!v.slowUseRatio || ok(v.slowRatio, 1)) && (!v.slowUseMs || ok(v.slowMinMs, 0)) &&
    (!v.errorUseRatio || ok(v.errorRatio, 1)) && (!v.errorUsePp || ok(v.errorMinPp, 0)) && ok(v.volumePct, 1) && ok(v.minCount, 0) && ok(v.keepDays, 0);
  /** 꺼 둔 칸은 검사하지 않으므로, 숫자가 아니면 지금 값을 그대로 둔다 */
  const keep = (s: string, min: number, prev: number) => (ok(s, min) ? num(s) : prev);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const save = () => {
    if (!valid) return;
    onSave(
      {
        slowRatio: keep(v.slowRatio, 1, rules.slowRatio),
        slowMinMs: keep(v.slowMinMs, 0, rules.slowMinMs),
        errorRatio: keep(v.errorRatio, 1, rules.errorRatio),
        errorMinDelta: keep(v.errorMinPp, 0, rules.errorMinDelta * 100) / 100,
        volumeRatio: num(v.volumePct) / 100,
        minCount: Math.round(num(v.minCount)),
        slowOn: v.slowOn,
        beyondWorst: v.beyondWorst,
        slowUseRatio: v.slowUseRatio,
        slowUseMs: v.slowUseMs,
        errorUseRatio: v.errorUseRatio,
        errorUsePp: v.errorUsePp,
        slowCombine: v.slowCombine,
        errorCombine: v.errorCombine,
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
      slowOn: DEFAULT_RULES.slowOn,
      beyondWorst: DEFAULT_RULES.beyondWorst,
      slowUseRatio: DEFAULT_RULES.slowUseRatio,
      slowUseMs: DEFAULT_RULES.slowUseMs,
      errorUseRatio: DEFAULT_RULES.errorUseRatio,
      errorUsePp: DEFAULT_RULES.errorUsePp,
      slowCombine: DEFAULT_RULES.slowCombine,
      errorCombine: DEFAULT_RULES.errorCombine,
    });

  return (
    <Dialog
      title={t('통계 설정')}
      onClose={onClose}
      widthClass="w-[50rem]"
      footer={
        <>
          <Button size="md" variant="ghost" onClick={reset} className="mr-auto">
            {t('판정 규칙 기본값')}
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
          <h3 className="font-medium text-fg">{t('판정 규칙')}</h3>
          <Row label={t('느려짐')}>
            <span title={t('여기서 고른 지표 중 하나라도 아래 조건에 걸리면 «느려짐» 입니다')}>{t('볼 지표')}</span>
            {SLOW_METRICS.map(m => (
              <label key={m} className="flex items-center gap-1 rounded border border-line px-2 py-0.5" title={termHelp(m)}>
                <input
                  type="checkbox"
                  checked={v.slowOn.includes(m)}
                  onChange={e =>
                    setV({ ...v, slowOn: SLOW_METRICS.filter(x => (x === m ? e.target.checked : v.slowOn.includes(x))) })
                  }
                />
                {slowName(m, t)}
              </label>
            ))}
          </Row>
          <Row label="">
            <Toggle on={v.slowUseRatio} onChange={x => setV({ ...v, slowUseRatio: x })}>
              {t('과거의')} <input className={inputCls} value={v.slowRatio} onChange={set('slowRatio')} disabled={!v.slowUseRatio} /> {t('배 이상')}
            </Toggle>
            <CombinePick value={v.slowCombine} enabled={v.slowUseRatio && v.slowUseMs} onChange={x => setV({ ...v, slowCombine: x })} />
            <Toggle on={v.slowUseMs} onChange={x => setV({ ...v, slowUseMs: x })}>
              <input className={inputCls} value={v.slowMinMs} onChange={set('slowMinMs')} disabled={!v.slowUseMs} /> ms {t('이상 늘어남')}
            </Toggle>
          </Row>
          <p className="pl-[6.5rem] text-small text-fg-faint">
            {t('p50 은 보통 요청, p90 은 대부분의 사용자, p99 는 드문 느린 요청(흔들림이 커서 경보가 늘 수 있다)을 봅니다.')}
          </p>
          <Row label={t('에러 증가')}>
            {t('에러율이')}
            <Toggle on={v.errorUseRatio} onChange={x => setV({ ...v, errorUseRatio: x })}>
              {t('과거의')} <input className={inputCls} value={v.errorRatio} onChange={set('errorRatio')} disabled={!v.errorUseRatio} /> {t('배 이상')}
            </Toggle>
            <CombinePick value={v.errorCombine} enabled={v.errorUseRatio && v.errorUsePp} onChange={x => setV({ ...v, errorCombine: x })} />
            <Toggle on={v.errorUsePp} onChange={x => setV({ ...v, errorUsePp: x })}>
              <input className={inputCls} value={v.errorMinPp} onChange={set('errorMinPp')} disabled={!v.errorUsePp} /> %p {t('이상 늘어남')}
            </Toggle>
          </Row>
          <p className="pl-[6.5rem] text-small text-fg-faint">
            {t('체크한 조건만 봅니다. 둘 다 체크하면 가운데에서 «그리고»(둘 다 넘어야) / «또는»(하나만 넘어도)를 고릅니다. 적어도 하나는 체크해야 합니다.')}
          </p>
          <Row label={t('호출량 급변')}>
            TPS ± <input className={inputCls} value={v.volumePct} onChange={set('volumePct')} /> % {t('넘게 변하면')}
          </Row>
          <Row label={t('표본 적음')}>
            {t('한쪽이')} <input className={inputCls} value={v.minCount} onChange={set('minCount')} /> {t('건 미만이면 판정하지 않음')}
          </Row>
          <Row label={t('과거가 여럿일 때')}>
            <label className="flex items-start gap-2 text-fg-muted">
              <input type="checkbox" className="mt-1" checked={v.beyondWorst} onChange={e => setV({ ...v, beyondWorst: e.target.checked })} />
              <span>
                {t('과거 날들 중 가장 나빴던 날보다도 나쁠 때만 «느려짐»·«에러 증가» 로 봅니다')}
                <br />
                <span className="text-small text-fg-faint">{t('날마다 들쭉날쭉한 서비스가 늘 뜨지 않게 합니다. 과거 구간이 하나면 쓰지 않습니다.')}</span>
              </span>
            </label>
          </Row>
          <p className="text-small text-fg-faint">{t('저장하면 지난 결과도 바로 다시 판정합니다.')}</p>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-fg">{t('결과 보관')}</h3>
          <Row label={t('보관 일수')}>
            <input className={inputCls} value={v.keepDays} onChange={set('keepDays')} /> {t('일 — 지난 결과는 목록을 열 때 지웁니다 (0 이면 지우지 않음)')}
          </Row>
        </section>
        {!valid && <p className="text-small text-danger">{v.slowOn.length === 0
              ? t('느려짐을 볼 지표를 하나 이상 고르세요')
              : !(v.slowUseRatio || v.slowUseMs) || !(v.errorUseRatio || v.errorUsePp)
                ? t('느려짐·에러 증가는 배율과 차이 중 적어도 하나를 체크하세요')
                : t('숫자를 확인하세요 (배수는 1 이상)')}</p>}
      </div>
    </Dialog>
  );
});

/** 배율·차이를 둘 다 쓸 때 묶는 법 — 하나만 켜져 있으면 흐리게(쓰지 않는다) */
function CombinePick({ value, enabled, onChange }: { value: Combine; enabled: boolean; onChange: (v: Combine) => void }) {
  return (
    <select
      value={value}
      disabled={!enabled}
      onChange={e => onChange(e.target.value === 'or' ? 'or' : 'and')}
      className="rounded border border-line-control bg-input px-1.5 py-1 pr-[22px] text-small font-semibold text-fg disabled:opacity-40"
      aria-label={t('두 조건을 묶는 법')}
      title={t('그리고: 둘 다 넘어야 · 또는: 하나만 넘어도')}
    >
      <option value="and">{t('그리고')}</option>
      <option value="or">{t('또는')}</option>
    </select>
  );
}

/** 조건 하나 켜고 끄기 — 끄면 그 칸은 흐려진다 */
function Toggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${on ? 'border-line-strong' : 'border-line opacity-55'}`}>
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-small text-fg-dim">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5 text-fg-muted">{children}</div>
    </div>
  );
}
