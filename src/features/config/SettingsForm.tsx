// 설정 화면 — 에이전트 · 콜렉터 공용
//
// 일반적인 애플리케이션 설정 화면의 모양을 따른다.
//   왼쪽  구역 목록 (네트워크 · 오브젝트 · 추적 …) — 몇 개가 기본값과 다른지 같이 적는다
//   오른쪽 항목 카드 — **한국어 이름이 제목**이고, 그 밑에 설명, 그 밑에 키와 공식 원문
//   아래  고친 것이 있을 때만 뜨는 저장 줄
//
// 한국어 이름·설명의 근거는 스카우터 공식 설정 문서다(`catalog/`). 공식 원문을 늘 같이 보여 주는
// 이유는 번역을 믿으라고 하지 않으려는 것이다 — 원문이 바로 밑에 있으면 어긋남을 사용자가 잡는다.
//
// **저장은 파일 통째로다** (F-40). 고친 것을 원문에 되돌려 넣고(`planConfigEdits`) 저장 전에
// 무엇이 바뀌는지 보여 준다.

import { memo, useMemo, useState } from 'react';
import { VALUE_TYPE, type ConfigView } from '../xlog/types/config';
import {
  ensureNotEmpty,
  planConfigEdits,
  validateValue,
  type ConfigChange,
} from '../xlog/components/configEdits';
import type { ConfigScope } from './catalog/types';
import { buildSections, isVisible, type SettingItem } from './settingsModel';
import { t } from '../../i18n';

interface SettingsFormProps {
  scope: ConfigScope;
  data: ConfigView;
  /** 경고문에 적을 대상 이름 */
  targetName: string;
  /** 원문 전체를 저장한다 */
  save: (text: string) => Promise<void>;
  /** 저장 성공 뒤 — **다시 읽게 한다.** 저장했다는 말만 믿지 않는다 */
  onSaved: () => void;
  /** 검색어 · 조건. 창의 머리줄이 쥐고 있다 */
  query: string;
  changedOnly: boolean;
  showInternal: boolean;
}

export const SettingsForm = memo(function SettingsForm({
  scope,
  data,
  targetName,
  save,
  onSaved,
  query,
  changedOnly,
  showInternal,
}: SettingsFormProps) {
  /** 키 → 고친 값. 지금 값과 같아지면 지운다 — «바뀜 0건» 이 정직해야 한다 */
  const [edits, setEdits] = useState<ReadonlyMap<string, string>>(new Map());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const sections = useMemo(() => buildSections(scope, data.entries), [scope, data.entries]);
  const byKey = useMemo(() => new Map(data.entries.map(e => [e.key, e])), [data.entries]);

  const editing = useMemo(() => new Set(edits.keys()), [edits]);
  const opts = { query, changedOnly, showInternal, editing };
  const visible = sections
    .map(s => ({ ...s, items: s.items.filter(i => isVisible(i, opts)) }))
    .filter(s => s.items.length > 0);

  /**
   * 어느 구역을 보여 줄지.
   *
   * **찾는 중에는 걸린 것을 전부 보여 준다** — 한 구역만 보여 주면 «찾았는데 왜 안 보이나» 가
   * 된다. 찾지 않을 때는 고른 구역 하나만 — 300개를 한 줄로 늘어놓으면 설정 파일을 훑는 것과
   * 다를 게 없다.
   */
  const searching = query.trim() !== '' || changedOnly;
  const current = visible.find(s => s.def.id === active) ?? visible[0];
  const shown = searching ? visible : current ? [current] : [];

  const setValue = (key: string, value: string) => {
    setEdits(prev => {
      const next = new Map(prev);
      if (value === byKey.get(key)?.value) next.delete(key);
      else next.set(key, value);
      return next;
    });
    // 확인 중에 값을 바꾸면 보여 준 목록이 거짓이 된다 — 다시 확인하게 한다
    setConfirming(false);
  };

  const undo = (key: string) => {
    setEdits(prev => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setConfirming(false);
  };

  const plan = useMemo(() => planConfigEdits(data.text, data.entries, edits), [data, edits]);
  const invalid = [...edits].filter(
    ([k, v]) => validateValue(v, byKey.get(k)?.value_type ?? 0) !== null,
  ).length;
  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) for (const i of s.items) m.set(i.entry.key, i.label);
    return m;
  }, [sections]);

  const doSave = () => {
    setBusy(true);
    setError(null);
    save(ensureNotEmpty(plan.text))
      .then(() => {
        setEdits(new Map());
        setConfirming(false);
        onSaved();
      })
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const described = data.entries.filter(e => e.desc !== '').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* 구역 목록 — 어디에 무엇이 있는지 한눈에. 기본값과 다른 것·고친 것의 수를 같이 적어,
            «이 서버는 어디를 손댔나» 가 목록만 봐도 보이게 한다 */}
        <nav aria-label={t('설정 구역')} className="w-48 shrink-0 overflow-y-auto border-r border-line py-2">
          {sections.map(s => {
            const hits = visible.find(v => v.def.id === s.def.id)?.items.length ?? 0;
            const changed = s.items.filter(i => i.entry.changed).length;
            const pending = s.items.filter(i => edits.has(i.entry.key)).length;
            const on = !searching && current?.def.id === s.def.id;
            const dim = searching && hits === 0;
            return (
              <button
                key={s.def.id}
                onClick={() => setActive(s.def.id)}
                disabled={dim}
                aria-current={on ? 'true' : undefined}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small ${
                  on ? 'bg-accent/15 text-fg' : dim ? 'text-fg-faint' : 'text-fg-muted hover:bg-hover'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{s.def.label}</span>
                {pending > 0 && (
                  <span className="shrink-0 rounded bg-warn/20 px-1 text-micro text-warn" title={t('저장하지 않은 바뀜')}>
                    {pending}
                  </span>
                )}
                {changed > 0 && (
                  <span className="shrink-0 text-micro text-accent" title={t('기본값과 다른 항목')}>
                    ●{changed}
                  </span>
                )}
                <span className="tnum shrink-0 text-micro text-fg-faint">{searching ? hits : s.items.length}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {described === 0 && data.entries.length > 0 && (
            // 설명은 카탈로그(공식 문서)에서 오므로 대부분 채워지지만, 서버가 설명을 안 주면
            // 공식 문서에 없는 항목은 설명이 없다. 그 사실을 말해 둔다.
            <p className="mx-4 mt-3 rounded border-l-2 border-line-strong bg-hover/40 px-2 py-1 text-micro text-fg-dim">
              {t('이 서버는 항목 설명을 주지 않습니다 (오래된 판). 공식 문서에 있는 항목만 설명이 붙습니다.')}
            </p>
          )}

          {shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-small text-fg-faint">
              {changedOnly ? t('기본값과 다른 설정이 없습니다.') : t('조건에 맞는 항목이 없습니다.')}
            </p>
          ) : (
            shown.map(s => (
              <section key={s.def.id} className="px-4 py-3">
                <h3 className="mb-2 text-base font-semibold text-fg">{s.def.label}</h3>
                <ol className="space-y-2">
                  {s.items.map(item => (
                    <Card
                      key={item.entry.key}
                      item={item}
                      draft={edits.get(item.entry.key)}
                      onChange={v => setValue(item.entry.key, v)}
                      onUndo={() => undo(item.entry.key)}
                    />
                  ))}
                </ol>
              </section>
            ))
          )}
        </div>
      </div>

      {error && (
        <p className="mx-4 mb-2 rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
          {error}
        </p>
      )}

      {/* 고친 것이 있을 때만 뜬다. 늘 떠 있으면 «저장할 게 있나» 를 매번 읽게 된다 */}
      {plan.changes.length > 0 && (
        <footer className="shrink-0 border-t border-line bg-overlay px-4 py-2">
          {confirming && (
            <ChangeList changes={plan.changes} targetName={targetName} labelOf={labelOf} scope={scope} />
          )}
          <div className="flex items-center gap-2">
            <span className="text-small text-fg-dim">
              <span className="tnum font-mono text-fg">{plan.changes.length}</span>
              {t('개 바꿈')}
            </span>
            {invalid > 0 && (
              <span className="text-small text-danger">
                · {t('고칠 값')} {invalid}
                {t('개')}
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => {
                setEdits(new Map());
                setConfirming(false);
              }}
              disabled={busy}
              className="rounded px-2 py-1 text-small text-fg-dim hover:bg-hover hover:text-fg"
            >
              {t('모두 되돌리기')}
            </button>
            {confirming ? (
              <button
                onClick={doSave}
                disabled={busy}
                className="rounded border border-danger px-3 py-1 text-small text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {busy ? t('저장 중…') : t('덮어쓰기')}
              </button>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                // **틀린 값이 있으면 저장하지 않는다.** 숫자 자리에 글자가 들어가면
                // 서버는 조용히 기본값을 쓴다 — 저장은 됐는데 설정은 안 먹는다.
                disabled={invalid > 0}
                title={invalid > 0 ? t('빨갛게 표시된 값을 먼저 고치세요') : undefined}
                className="rounded bg-accent px-3 py-1 text-small text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-fg-faint"
              >
                {t('저장…')}
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
});

/** 항목 카드 하나 */
function Card({
  item,
  draft,
  onChange,
  onUndo,
}: {
  item: SettingItem;
  /** 고친 값. 안 고쳤으면 undefined */
  draft: string | undefined;
  onChange: (value: string) => void;
  onUndo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const e = item.entry;
  const value = draft ?? e.value;
  const pending = draft !== undefined;
  const error = pending ? validateValue(value, e.value_type) : null;
  const atDefault = value === e.default;

  // 공식 원문이 길면 접는다(텔레그래프 카운터 대응은 열 줄이 넘는다)
  const official = item.officialDesc;
  const longOfficial = official.includes('\n') || official.length > 140;

  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_minmax(220px,300px)] items-start gap-x-6 rounded-lg border px-4 py-3 ${
        pending
          ? 'border-warn/60 bg-warn/5'
          : e.changed
            ? 'border-accent/40 bg-accent/5'
            : 'border-line bg-surface'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-small font-medium text-fg">{item.label}</span>
          {pending && <Badge tone="warn">{t('바꿈')}</Badge>}
          {!pending && e.changed && <Badge tone="accent">{t('기본값과 다름')}</Badge>}
          {item.restartRequired && (
            <Badge tone="warn" title={t('공식 문서에 «restart required» 로 적힌 항목입니다')}>
              {t('재시작 필요')}
            </Badge>
          )}
          {item.deprecated && <Badge tone="dim">{t('사용 안 함')}</Badge>}
          {item.template && (
            <Badge tone="dim" title={t('공식 문서의 예시 항목입니다 — $measurement$ 자리에 실제 측정값 이름을 넣어 씁니다')}>
              {t('예시 항목')}
            </Badge>
          )}
          {item.internal && <Badge tone="dim">{t('내부')}</Badge>}
        </div>

        {item.koDesc !== '' && (
          <p className="mt-1 text-small whitespace-pre-wrap text-fg-muted">{item.koDesc}</p>
        )}

        <p className="mt-1 text-micro text-fg-faint">
          <span className="font-mono text-fg-dim" title={e.key}>
            {e.key}
          </span>
          {' · '}
          {official === '' ? (
            <span className="italic">{t('공식 설명 없음')}</span>
          ) : (
            <span className={`whitespace-pre-wrap ${open ? '' : 'line-clamp-1'}`} title={t('스카우터 공식 문서의 원문')}>
              {t('공식')}: {official}
            </span>
          )}
        </p>
        {longOfficial && (
          <button onClick={() => setOpen(o => !o)} className="text-micro text-fg-faint hover:text-fg">
            {open ? t('접기') : t('원문 더 보기')}
          </button>
        )}
      </div>

      <div className="min-w-0">
        <Editor itemKey={e.key} valueType={e.value_type} value={value} invalid={error !== null} onChange={onChange} />
        {error && <p className="mt-1 text-micro text-danger">{t(error)}</p>}
        <div className="mt-1 flex items-baseline gap-2 text-micro">
          {/* 기본값은 **다를 때만** 적는다 — 같은 값을 두 번 쓰면 카드가 안 읽힌다 */}
          {!atDefault && (
            <span className="min-w-0 truncate text-fg-faint" title={e.default}>
              {t('기본')} <span className="font-mono">{e.default || t('(비어 있음)')}</span>
            </span>
          )}
          <div className="flex-1" />
          {pending && (
            <button onClick={onUndo} className="shrink-0 text-fg-faint hover:text-fg">
              {t('되돌리기')}
            </button>
          )}
          {!atDefault && (
            <button
              onClick={() => onChange(e.default)}
              // 저장하면 파일에서 이 줄이 지워진다 — 기본값을 박아 두지 않고 따라가게 한다
              title={t('이 줄을 설정 파일에서 지워 기본값을 따르게 합니다')}
              className="shrink-0 text-accent hover:underline"
            >
              {t('기본값으로')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function Badge({
  tone,
  title,
  children,
}: {
  tone: 'warn' | 'accent' | 'dim';
  title?: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === 'warn'
      ? 'border-warn/40 text-warn'
      : tone === 'accent'
        ? 'border-accent/40 text-accent'
        : 'border-line-strong text-fg-faint';
  return (
    <span title={title} className={`rounded border px-1 text-micro ${cls}`}>
      {children}
    </span>
  );
}

const INPUT =
  'w-full rounded border bg-input px-2 py-1 font-mono text-small text-fg outline-none focus:border-accent';

/** 값 종류에 맞는 입력기 */
function Editor({
  itemKey,
  valueType,
  value,
  invalid,
  onChange,
}: {
  itemKey: string;
  valueType: number;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const border = invalid ? 'border-danger' : 'border-line-strong';

  switch (valueType) {
    case VALUE_TYPE.BOOL: {
      // **스위치는 값이 true/false 일 때만 쓴다.** 손으로 `yes` 라고 적어 둔 파일이면
      // 스위치로는 그 값을 보여 줄 수 없다 — 그때는 글자 칸으로 둔다(오류가 같이 뜬다).
      if (value !== 'true' && value !== 'false') break;
      const on = value === 'true';
      return (
        <button
          role="switch"
          aria-checked={on}
          aria-label={itemKey}
          onClick={() => onChange(on ? 'false' : 'true')}
          className="flex items-center gap-2 text-small"
        >
          <span
            className={`relative inline-block h-5 w-9 rounded-full transition-colors ${
              on ? 'bg-accent' : 'bg-line-strong'
            }`}
          >
            <span
              className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${
                on ? 'left-4.5' : 'left-0.5'
              }`}
            />
          </span>
          <span className={on ? 'text-fg' : 'text-fg-dim'}>{on ? t('켜짐') : t('꺼짐')}</span>
        </button>
      );
    }
    case VALUE_TYPE.NUM:
      return (
        <input
          // type=number 를 쓰지 않는다 — 비우면 값이 사라지고, 휠에 값이 바뀐다
          inputMode="numeric"
          value={value}
          onChange={ev => onChange(ev.target.value)}
          aria-label={itemKey}
          aria-invalid={invalid}
          className={`${INPUT} ${border}`}
        />
      );
    case VALUE_TYPE.COMMA_SEPARATED:
    case VALUE_TYPE.COMMA_COLON_SEPARATED:
      return (
        <>
          <input
            value={value}
            onChange={ev => onChange(ev.target.value)}
            aria-label={itemKey}
            aria-invalid={invalid}
            className={`${INPUT} ${border}`}
          />
          <p className="mt-0.5 text-micro text-fg-faint">
            {valueType === VALUE_TYPE.COMMA_SEPARATED
              ? t('쉼표로 구분합니다 — a,b,c')
              : t('«이름:값» 을 쉼표로 구분합니다 — a:1,b:2')}
          </p>
        </>
      );
  }

  return (
    <input
      value={value}
      onChange={ev => onChange(ev.target.value)}
      aria-label={itemKey}
      aria-invalid={invalid}
      className={`${INPUT} ${border}`}
    />
  );
}

/**
 * 저장 전 확인 — **무엇이 바뀌는지.**
 *
 * «정말 저장할까요?» 만 묻고 무엇을 저장하는지 안 보여 주면, 누르는 사람은 방금 무엇을
 * 건드렸는지 기억에 기대야 한다. 파일을 통째로 덮는 저장이라 특히 그렇다.
 */
function ChangeList({
  changes,
  targetName,
  labelOf,
  scope,
}: {
  changes: readonly ConfigChange[];
  targetName: string;
  labelOf: ReadonlyMap<string, string>;
  scope: ConfigScope;
}) {
  const kindLabel: Record<ConfigChange['kind'], string> = {
    set: t('값 바꿈'),
    add: t('새로 적음'),
    remove: t('줄 지움 → 기본값'),
  };
  return (
    <div className="mb-2">
      <p className="mb-1 rounded border-l-2 border-warn bg-warn/10 px-2 py-1 text-micro text-warn">
        {t('저장하면')} <span className="font-mono">{targetName}</span>{' '}
        {scope === 'server'
          ? t('의 설정 파일이 아래처럼 바뀐 채로 통째로 저장되고 콜렉터가 설정을 다시 읽습니다.')
          : t('의 설정 파일이 아래처럼 바뀐 채로 통째로 저장되고 에이전트가 설정을 다시 읽습니다.')}{' '}
        {t('«재시작 필요» 로 표시된 항목은 재시작해야 적용됩니다.')}
      </p>
      <ul className="max-h-48 overflow-auto rounded border border-line bg-base">
        {changes.map(c => (
          <li
            key={c.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line/40 px-2 py-1 last:border-b-0"
          >
            <span className="min-w-0 truncate text-small text-fg" title={c.key}>
              {labelOf.get(c.key) ?? c.key}
              <span className="ml-1.5 font-mono text-micro text-fg-faint">{c.key}</span>
            </span>
            <span className="text-micro text-fg-faint">{kindLabel[c.kind]}</span>
            <span className="col-span-2 min-w-0 truncate font-mono text-micro">
              <span className="text-fg-dim line-through">{c.before || t('(비어 있음)')}</span>
              <span className="mx-1 text-fg-faint">→</span>
              <span className="text-fg">{c.after || t('(비어 있음)')}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
