// 프로파일 스텝 본문 — **전체 보기.**
//
// 지금까지 전문을 볼 수 있는 것은 SQL 뿐이었다. SAP PO 어댑터의
// `RECEIVER_PAYLOAD(XML)` 처럼 XML 한 통이 통째로 실려 오는 스텝은 한 줄로 잘리고,
// 마우스를 올리면 수천 자짜리 툴팁이 화면을 덮었다 — 읽을 수도, 고를 수도, 복사할
// 수도 없다.
//
// **자를 것이 없다.** 에이전트는 메시지 스텝을 길이 제한 없이 보낸다
// (`MessageStep.write` → `DataOutputX.writeText` → `writeBlob`) — 잘린 것은 화면뿐이다.
// 다만 **그 메시지를 만든 쪽**(플러그인·후킹)이 미리 잘라 보냈다면 여기서 되살릴 수
// 없다. 그건 에이전트 쪽에서 봐야 한다.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton } from '../../../components/CopyButton';
import { formatSql } from './sqlFormat';
import { detectFormat, formatBody } from './textFormat';
import { t } from '../../../i18n';

interface StepDetailDialogProps {
  /** 배지에 적을 종류 글자 (`SQL`·`API`·`MSG`…) */
  kind: string;
  /** 창 제목에 적을 스텝 이름 */
  title: string;
  body: string;
  onClose: () => void;
}

/** 본문에서 검색어가 나오는 자리 */
function findAll(body: string, query: string): number[] {
  if (query === '') return [];
  const hay = body.toLowerCase();
  const needle = query.toLowerCase();
  const out: number[] = [];
  let at = hay.indexOf(needle);
  while (at >= 0) {
    out.push(at);
    at = hay.indexOf(needle, at + needle.length);
  }
  return out;
}

export const StepDetailDialog = memo(function StepDetailDialog({
  kind,
  title,
  body,
  onClose,
}: StepDetailDialogProps) {
  const format = useMemo(() => detectFormat(body), [body]);
  /** 나눠 볼 수 있는 종류인가. `text` 는 나눌 것이 없다 */
  const splittable = format !== 'text';
  const [pretty, setPretty] = useState(splittable);
  const [wrap, setWrap] = useState(true);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(0);

  const shown = useMemo(() => {
    if (!pretty) return body;
    return format === 'sql' ? formatSql(body) : formatBody(body, format);
  }, [body, format, pretty]);

  const hits = useMemo(() => findAll(shown, query.trim()), [shown, query]);
  // 검색어를 고치면 처음 적중으로 돌아간다 — 안 그러면 «3/2번째» 같은 자리가 생긴다.
  useEffect(() => setHit(0), [query, pretty]);

  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (hits.length === 0) return;
    // jsdom 에는 scrollIntoView 가 없다. 있을 때만 부른다.
    preRef.current?.querySelector('[data-hit="on"]')?.scrollIntoView?.({ block: 'center' });
  }, [hit, hits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const step = (d: number) => {
    if (hits.length === 0) return;
    setHit(n => (n + d + hits.length) % hits.length);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={t('본문 전체 보기')}
        onClick={e => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line-strong bg-raised shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
          <span className="font-mono text-micro text-fg-dim">{kind}</span>
          <h2 className="min-w-0 truncate text-base font-medium text-fg" title={title}>
            {title}
          </h2>
          <div className="flex-1" />
          <span className="shrink-0 font-mono text-micro text-fg-faint">
            {body.length.toLocaleString()}
            {t('자')}
          </span>
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
          >
            ✕
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          {/* **원문으로 돌아갈 수 있어야 한다.** 나눈 모양이 원문과 다르게 보일 때
              무엇이 실제로 오갔는지 확인할 방법이 있어야 근거로 쓸 수 있다. */}
          {splittable && (
            <button
              type="button"
              onClick={() => setPretty(p => !p)}
              aria-pressed={pretty}
              className={`rounded px-2 py-0.5 text-micro ${
                pretty ? 'bg-accent/15 text-accent' : 'text-fg-dim hover:bg-hover hover:text-fg'
              }`}
            >
              {t('정렬해 보기')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setWrap(w => !w)}
            aria-pressed={wrap}
            className={`rounded px-2 py-0.5 text-micro ${
              wrap ? 'bg-accent/15 text-accent' : 'text-fg-dim hover:bg-hover hover:text-fg'
            }`}
          >
            {t('줄 바꿔 보기')}
          </button>

          <div className="flex-1" />

          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
            }}
            placeholder={t('본문에서 찾기')}
            aria-label={t('본문에서 찾기')}
            className="search-field w-56 text-micro"
          />
          {query.trim() !== '' && (
            <span className="font-mono text-micro text-fg-faint">
              {hits.length === 0 ? t('없음') : `${hit + 1}/${hits.length}`}
            </span>
          )}
          {hits.length > 0 && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t('이전 적중')}
                className="rounded px-1.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t('다음 적중')}
                className="rounded px-1.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
              >
                ↓
              </button>
            </span>
          )}
          {/* **보고 있는 모양 그대로 복사한다.** 정렬해 둔 채 원문이 복사되면
              창에서 고른 자리와 붙여 넣은 것이 어긋난다. */}
          <CopyButton text={shown} />
        </div>

        <pre
          ref={preRef}
          className={`min-h-0 flex-1 overflow-auto bg-base px-4 py-3 font-mono text-small leading-relaxed text-fg ${
            wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'
          }`}
        >
          <Marked text={shown} query={query.trim()} active={hit} hits={hits} />
        </pre>
      </div>
    </div>
  );
});

/** 적중한 자리를 표시한다. 지금 보고 있는 적중은 따로 칠한다 */
function Marked({
  text,
  query,
  active,
  hits,
}: {
  text: string;
  query: string;
  active: number;
  hits: readonly number[];
}) {
  if (query === '' || hits.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  hits.forEach((at, i) => {
    if (at > cursor) parts.push(text.slice(cursor, at));
    const on = i === active;
    parts.push(
      <mark
        key={at}
        data-hit={on ? 'on' : 'off'}
        className={on ? 'bg-accent text-base' : 'bg-accent/25 text-fg'}
      >
        {text.slice(at, at + query.length)}
      </mark>,
    );
    cursor = at + query.length;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
