// 넓은 구간에서 조건으로 트랜잭션 찾기.
//
// **스캐터 드래그를 대체하지 않는다.** 좁은 구간은 다 받아서 화면에서 거르는 편이 낫다 —
// 잘림이 없고 오브젝트를 여럿 다룬다. 이 창은 «오늘 오전 내내 중 이 서비스만» 처럼
// 드래그로는 여러 번 나눠 받아야 하는 것을 한 번에 찾기 위한 입구다 (F-54).
//
// **대소문자를 가리지 않는다.** 화면의 다른 필터와 같다. 예전에는 콜렉터 검색에 조건을 넘겨
// 대소문자를 가렸다(`order` 로 `/Order/…` 를 못 찾음) — 지금은 구간을 받아 앱이 거른다
// (`wideSearchAll.ts`). 창에는 모두 모으는 양을 적어 두고, 찾는 동안 진행을 보인다.

import { memo, useState } from 'react';
import type { AgentObject } from '../types/xlog';
import type { WideProgress } from '../hooks/wideSearchAll';
import { t } from '../../../i18n';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';

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
  /** 고를 수 있는 오브젝트 */
  agents: AgentObject[];
  running: boolean;
  /** 찾는 중의 진행. 안 찾고 있으면 null */
  progress: WideProgress | null;
  /** 찾는 것을 멈춘다 — 그때까지 모은 것은 목록으로 간다 */
  onCancel: () => void;
  /** 모두 모을 최대 건수 (설정 «트랜잭션 찾기 상한») */
  cap: number;
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
  progress,
  onCancel,
  cap,
  onSearch,
  onClose,
}: WideSearchDialogProps) {
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
    <Dialog
      title={t('넓은 구간에서 찾기')}
      onClose={onClose}
      widthClass="w-[34rem]"
      footer={
        <>
          {/* 넓은 구간은 조각으로 나눠 여러 번 묻는다 — 몇 건 모았고 어디까지 왔는지 보여 줘야 기다릴지 정한다 */}
          {progress && (
            <span className="mr-auto text-micro text-fg-dim" role="status">
              <span className="tnum font-mono text-fg-muted">{progress.found.toLocaleString()}</span>
              {t('건')} · {Math.round(progress.done * 100)}% · {t('요청')} {progress.requests}
            </span>
          )}
          {running ? (
            <Button size="md" onClick={onCancel} title={t('그때까지 모은 것을 목록으로 보냅니다')}>
              {t('멈추기')}
            </Button>
          ) : (
            <Button size="md" onClick={onClose}>
              {t('취소')}
            </Button>
          )}
          <Button variant="primary" size="md" onClick={submit} disabled={badRange || running}>
            {running ? t('찾는 중…') : t('찾기')}
          </Button>
        </>
      }
    >
      <div
        onKeyDown={e => {
          if (e.key === 'Enter') submit();
        }}
      >

        {/* **상한을 먼저 말한다.** 찾고 나서 알려주면 이미 «없다» 고 읽은 뒤다 */}
        <p className="mb-3 text-micro text-fg-dim">
          {t('구간을 받아 조건으로 거릅니다. 모두')}{' '}
          <span className="tnum font-mono text-fg-muted">{cap.toLocaleString()}</span>
          {t('건까지 모읍니다.')} <span className="text-fg-faint">{t('(설정에서 바꿈)')}</span>
        </p>

        <Row label={t('구간')}>
          <input
            type="datetime-local"
            value={stime}
            onChange={e => setStime(e.target.value)}
            className="rounded border border-line-control bg-input px-2 py-0.5 text-body text-fg"
          />
          <span className="text-fg-faint">–</span>
          <input
            type="datetime-local"
            value={etime}
            onChange={e => setEtime(e.target.value)}
            className="rounded border border-line-control bg-input px-2 py-0.5 text-body text-fg"
          />
        </Row>
        {badRange && (
          <p className="mb-2 text-micro text-danger">{t('시작이 끝보다 앞서야 합니다')}</p>
        )}

        <Row label={t('오브젝트')}>
          <select
            value={objHash}
            onChange={e => setObjHash(Number(e.target.value))}
            className="min-w-0 flex-1 rounded border border-line-control bg-input px-2 py-0.5 pr-[26px] text-body text-fg"
          >
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

        {/* **규칙을 적어 둔다.** `*` 를 쓰면 «포함» 이 아니라 그 모양 그대로 맞춘다 */}
        <p className="mb-3 mt-1 text-micro text-fg-faint">
          {t('그냥 치면 «포함»으로 찾습니다. * 를 직접 쓰면 그 자리만 아무 글자로 봅니다.')}{' '}
          {t('대소문자는 가리지 않습니다.')}
        </p>

        <Button variant="ghost" size="xs" onClick={() => setShowFree(v => !v)} className="mb-2">
          {showFree ? t('앱 자유 필드 접기') : t('앱 자유 필드 (text1~5)')}
        </Button>
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

      </div>
    </Dialog>
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
      className="min-w-0 flex-1 rounded border border-line-control bg-input px-2 py-0.5 text-body text-fg placeholder:text-fg-faint"
    />
  );
}
