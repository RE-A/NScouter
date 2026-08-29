// 넓은 구간에서 조건으로 트랜잭션 찾기.
//
// **스캐터 드래그를 대체하지 않는다.** 좁은 구간은 다 받아서 화면에서 거르는 편이 낫다 —
// 잘림이 없고 오브젝트를 여럿 다룬다. 이 창은 «오늘 오전 내내 중 이 서비스만» 처럼
// 드래그로는 여러 번 나눠 받아야 하는 것을 한 번에 찾기 위한 입구다 (F-54).
//
// **상한을 숨기지 않는다.** 서버는 `req_search_xlog_max_count`(기본 500)에서 그냥 끊고
// «잘렸다» 는 신호를 아무것도 주지 않는다. 그걸 화면이 말하지 않으면 없는 트랜잭션을
// 없다고 믿게 된다 — 그래서 창을 열 때부터 상한을 적어 두고, 닿으면 결과에 경고를 단다.

import { memo, useEffect, useState } from 'react';
import type { AgentObject } from '../types/xlog';
import { getSearchMax } from '../api/scouterApi';
import { t } from '../../../i18n';

export interface WideSearchValues {
  stime: number;
  etime: number;
  objHash: number;
  service: string;
  ip: string;
  login: string;
  desc: string;
  text1: string;
  text2: string;
  text3: string;
  text4: string;
  text5: string;
}

interface WideSearchDialogProps {
  /** 고를 수 있는 오브젝트. 서버가 **하나만** 받는다 */
  agents: AgentObject[];
  running: boolean;
  onSearch: (v: WideSearchValues) => void;
  onClose: () => void;
}

/** `datetime-local` 이 받는 모양. 로컬 시각이라 ISO 로 바꾸면 안 된다 */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(s: string): number {
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export const WideSearchDialog = memo(function WideSearchDialog({
  agents,
  running,
  onSearch,
  onClose,
}: WideSearchDialogProps) {
  /**
   * 상한을 **물어보고 나서** 적는다.
   *
   * 안 물어보고 기본값(500)을 단정하면, 서버가 상한을 올려 뒀을 때 화면이 거짓말을 한다.
   * 못 물어봤으면 «모른다» 고 두고, 그때만 기본값을 «추측» 이라고 밝힌다.
   */
  const [limit, setLimit] = useState<{ max: number; known: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    getSearchMax()
      .then(m => { if (alive) setLimit(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const now = Date.now();
  const [stime, setStime] = useState(toLocalInput(now - 60 * 60 * 1000));
  const [etime, setEtime] = useState(toLocalInput(now));
  const [objHash, setObjHash] = useState(0);
  const [service, setService] = useState('');
  const [ip, setIp] = useState('');
  const [login, setLogin] = useState('');
  const [desc, setDesc] = useState('');
  const [text1, setText1] = useState('');
  const [text2, setText2] = useState('');
  const [text3, setText3] = useState('');
  const [text4, setText4] = useState('');
  const [text5, setText5] = useState('');
  // text1~5 는 앱이 직접 심는 자유 필드다. 안 쓰는 곳이 대부분이라 접어 둔다.
  const [showFree, setShowFree] = useState(false);

  const range = { s: fromLocalInput(stime), e: fromLocalInput(etime) };
  const badRange = range.s <= 0 || range.e <= 0 || range.s >= range.e;

  const submit = () => {
    if (badRange || running) return;
    onSearch({
      stime: range.s,
      etime: range.e,
      objHash,
      service,
      ip,
      login,
      desc,
      text1,
      text2,
      text3,
      text4,
      text5,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') submit();
        }}
        className="max-h-[90vh] w-[34rem] overflow-y-auto rounded border border-line-strong bg-surface p-4"
      >
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-body font-semibold text-fg">{t('넓은 구간에서 찾기')}</h2>
          <button
            onClick={onClose}
            aria-label={t('닫기')}
            className="rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
          >
            ✕
          </button>
        </div>

        {/* **상한을 먼저 말한다.** 찾고 나서 알려주면 이미 «없다» 고 읽은 뒤다 */}
        <p className="mb-3 text-micro text-fg-dim">
          {limit === null ? (
            // 아직 안 물어봤다. 숫자를 지어내지 않는다.
            t('서버가 걸러서 보내 줍니다. 상한을 확인하는 중입니다…')
          ) : (
            <>
              {t('서버가 걸러서 보내 줍니다. 최대')}{' '}
              <span className="tnum font-mono text-warn">{limit.max.toLocaleString()}</span>
              {t('건까지만 오고, 그보다 많으면 잘립니다.')}
              {!limit.known && (
                <span className="text-fg-faint">
                  {' '}
                  {t('(서버 설정에 상한이 안 적혀 있어 기본값으로 봅니다)')}
                </span>
              )}
            </>
          )}
        </p>

        <Row label={t('구간')}>
          <input
            type="datetime-local"
            value={stime}
            onChange={e => setStime(e.target.value)}
            className="rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg"
          />
          <span className="text-fg-faint">–</span>
          <input
            type="datetime-local"
            value={etime}
            onChange={e => setEtime(e.target.value)}
            className="rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg"
          />
        </Row>
        {badRange && (
          <p className="mb-2 text-micro text-danger">{t('시작이 끝보다 앞서야 합니다')}</p>
        )}

        <Row label={t('오브젝트')}>
          <select
            value={objHash}
            onChange={e => setObjHash(Number(e.target.value))}
            className="min-w-0 flex-1 rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg"
          >
            {/* 서버가 **하나만** 받는다. 목록으로 좁힐 수 없다 */}
            <option value={0}>{t('전체')}</option>
            {agents.map(a => (
              <option key={a.obj_hash} value={a.obj_hash}>
                {a.obj_name}
              </option>
            ))}
          </select>
        </Row>

        <Row label={t('서비스')}>
          <Text value={service} onChange={setService} placeholder="/order/orders" />
        </Row>
        <Row label="IP">
          <Text value={ip} onChange={setIp} placeholder="10.89." />
        </Row>
        <Row label={t('로그인')}>
          <Text value={login} onChange={setLogin} placeholder="" />
        </Row>
        <Row label={t('설명')}>
          <Text value={desc} onChange={setDesc} placeholder="" />
        </Row>

        {/* **글롭 규칙을 적어 둔다.** 서버는 `*` 가 없으면 완전 일치로 본다 */}
        <p className="mb-3 mt-1 text-micro text-fg-faint">
          {t('그냥 치면 «포함»으로 찾습니다. * 를 직접 쓰면 그 자리만 아무 글자로 봅니다.')}
        </p>

        <button
          type="button"
          onClick={() => setShowFree(v => !v)}
          className="mb-2 rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
        >
          {showFree ? t('앱 자유 필드 접기') : t('앱 자유 필드 (text1~5)')}
        </button>
        {showFree && (
          <>
            <Row label="text1">
              <Text value={text1} onChange={setText1} placeholder="" />
            </Row>
            <Row label="text2">
              <Text value={text2} onChange={setText2} placeholder="" />
            </Row>
            <Row label="text3">
              <Text value={text3} onChange={setText3} placeholder="" />
            </Row>
            <Row label="text4">
              <Text value={text4} onChange={setText4} placeholder="" />
            </Row>
            <Row label="text5">
              <Text value={text5} onChange={setText5} placeholder="" />
            </Row>
          </>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-line-strong px-3 py-1 text-small text-fg-muted hover:bg-hover"
          >
            {t('취소')}
          </button>
          <button
            onClick={submit}
            disabled={badRange || running}
            className="rounded border border-accent px-3 py-1 text-small text-accent hover:bg-hover disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint"
          >
            {running ? t('찾는 중…') : t('찾기')}
          </button>
        </div>
      </div>
    </div>
  );
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-16 shrink-0 text-micro text-fg-dim">{label}</span>
      {children}
    </div>
  );
}

function Text({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      spellCheck={false}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg placeholder:text-fg-faint"
    />
  );
}
