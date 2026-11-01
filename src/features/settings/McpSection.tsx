// 설정 창 «AI 연결 (MCP)» — Claude Code · Cursor 가 이 앱을 거쳐 트랜잭션을 읽게 한다.
//
// **저장 단추와 따로 바로 적용한다.** 켜는 순간 서버가 떠야 아래 명령을 복사해 바로 붙여 볼 수
// 있다. 그래서 설정 창의 «저장» 은 이 칸을 건드리지 않는다(Rust `save_config` 가 지킨다).

import { useCallback, useEffect, useState } from 'react';
import { mcpConfigure, mcpRegenerateToken, mcpSetLimits, mcpSync, type McpLimits, type McpStatus } from '../xlog/api/scouterApi';
import { NumberField } from './NumberField';
import { CopyButton } from '../../components/CopyButton';
import { Button } from '../../components/Button';
import { t } from '../../i18n';

/** 클라이언트에 붙여 넣을 주소 */
export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

/** Claude Code 에 등록하는 명령 한 줄 */
export function claudeCodeCommand(port: number, token: string): string {
  return `claude mcp add --transport http nscouter ${mcpUrl(port)} --header "Authorization: Bearer ${token}"`;
}

/** Cursor 의 `mcp.json` 에 넣을 내용 */
export function cursorConfig(port: number, token: string): string {
  return JSON.stringify(
    { mcpServers: { nscouter: { url: mcpUrl(port), headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

const CODE = 'block whitespace-pre-wrap break-all rounded bg-hover px-2 py-1.5 font-mono text-micro text-fg-muted';

export function McpSection() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  /** 고치는 중인 포트 (적용 전) */
  const [portText, setPortText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 한도 칸 펼침 — 평소에는 접어 둔다 */
  const [showLimits, setShowLimits] = useState(false);

  const take = useCallback((s: McpStatus) => {
    setStatus(s);
    setPortText(String(s.port));
  }, []);

  useEffect(() => {
    mcpSync().then(take).catch(e => setError(String(e)));
  }, [take]);

  const run = useCallback(async (job: () => Promise<McpStatus>) => {
    setBusy(true);
    setError(null);
    try {
      take(await job());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [take]);

  const port = Number(portText);
  const portOk = Number.isInteger(port) && port >= 1024 && port <= 65535;

  const apply = (patch: { enabled?: boolean; bindValues?: boolean }) => {
    if (!status) return;
    void run(() =>
      mcpConfigure(
        patch.enabled ?? status.enabled,
        portOk ? port : status.port,
        patch.bindValues ?? status.bind_values,
      ),
    );
  };

  const applyPort = () => {
    if (!status || !portOk || port === status.port) return;
    void run(() => mcpConfigure(status.enabled, port, status.bind_values));
  };

  if (!status) {
    return error ? <div className="text-body text-danger">{error}</div> : null;
  }

  const live = status.running;
  return (
    <div className="flex flex-col gap-2 text-small">
      <label className="flex cursor-pointer items-center gap-2 text-body text-fg">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={e => apply({ enabled: e.target.checked })}
        />
        {t('켜기')}
        <span className={live ? 'text-ok' : status.enabled ? 'text-danger' : 'text-fg-faint'}>
          {live ? `● ${t('실행 중')} · ${mcpUrl(status.port)}` : status.enabled ? `● ${t('시작 못 함')}` : t('꺼짐')}
        </span>
      </label>

      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-fg-faint">{t('포트')}</span>
        <input
          value={portText}
          inputMode="numeric"
          onChange={e => setPortText(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={applyPort}
          onKeyDown={e => { if (e.key === 'Enter') applyPort(); }}
          disabled={busy}
          className="w-24 rounded border border-line-control bg-input px-1.5 py-0.5 font-mono text-body text-fg"
        />
        {!portOk && <span className="text-danger">{t('1024~65535')}</span>}
      </div>

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={status.bind_values}
          disabled={busy}
          onChange={e => apply({ bindValues: e.target.checked })}
        />
        <span className="text-fg-muted">
          {t('SQL 바인딩 값도 넘기기')}
          <span className="block text-fg-faint">
            {t('상세 조회에 실제 값을 실을지입니다. 프로파일 본문 검색은 이 설정과 상관없이 값까지 찾습니다.')}
          </span>
        </span>
      </label>

      <div>
        <Button variant="ghost" size="xs" onClick={() => setShowLimits(v => !v)} aria-expanded={showLimits}>
          {showLimits ? t('조회 한도 접기') : t('조회 한도 (건수·시간)')}
        </Button>
      </div>
      {showLimits && (
        <LimitFields
          limits={status.limits}
          disabled={busy}
          onChange={patch => void run(() => mcpSetLimits({ ...status.limits, ...patch }))}
        />
      )}

      {(status.error || error) && <div className="text-danger">{error ?? status.error}</div>}

      {status.token && (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-16 shrink-0 text-fg-faint">{t('토큰')}</span>
            <code className="min-w-0 flex-1 truncate font-mono text-micro text-fg-dim">{status.token}</code>
            <CopyButton text={status.token} />
            <Button
              size="xs"
              disabled={busy}
              onClick={() => void run(mcpRegenerateToken)}
              title={t('새 토큰을 만듭니다. 예전 토큰으로 등록한 클라이언트는 다시 등록해야 합니다')}
            >
              {t('새로 만들기')}
            </Button>
          </div>

          <div className="mt-1 text-fg-faint">{t('Claude Code — 터미널에서 한 번 실행')}</div>
          <div className="flex items-start gap-1">
            <code className={`${CODE} min-w-0 flex-1`}>{claudeCodeCommand(status.port, status.token)}</code>
            <CopyButton text={claudeCodeCommand(status.port, status.token)} />
          </div>

          <div className="mt-1 text-fg-faint">
            {t('Cursor — ~/.cursor/mcp.json (프로젝트만이면 .cursor/mcp.json) 에 넣기')}
          </div>
          <div className="flex items-start gap-1">
            <code className={`${CODE} min-w-0 flex-1`}>{cursorConfig(status.port, status.token)}</code>
            <CopyButton text={cursorConfig(status.port, status.token)} />
          </div>
        </>
      )}
    </div>
  );
}

/** AI 가 한 번에 가져갈 수 있는 양. **바로 적용된다** — 바꾼 다음 호출부터 쓴다 */
function LimitFields({
  limits,
  disabled,
  onChange,
}: {
  limits: McpLimits;
  disabled: boolean;
  onChange: (patch: Partial<McpLimits>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 pl-1">
      <NumberField label={t('목록 — 최대 건수')} value={limits.list_max} min={10} max={5000} unit={t('건')} disabled={disabled}
        onChange={v => onChange({ list_max: v })} hint={t('search_transactions 가 한 번에 돌려주는 최대 행 수')} />
      <NumberField label={t('목록 — 최대 구간')} value={limits.max_minutes} min={10} max={1440} unit={t('분')} disabled={disabled}
        onChange={v => onChange({ max_minutes: v })} />
      <NumberField label={t('목록 — 훑을 최대 건수')} value={limits.scan_max_rows} min={10000} max={2000000} unit={t('건')} disabled={disabled}
        onChange={v => onChange({ scan_max_rows: v })} hint={t('넘으면 «다 못 훑었다» 고 알리고 멈춥니다')} />
      <NumberField label={t('상세 — 한 번에 최대')} value={limits.detail_max} min={1} max={20} unit={t('건')} disabled={disabled}
        onChange={v => onChange({ detail_max: v })} hint={t('get_transaction_details 가 한 번에 받는 ref 수')} />
      <NumberField label={t('프로파일 검색 — 새로 받을 최대')} value={limits.profile_fetch_max} min={100} max={20000} unit={t('건')} disabled={disabled}
        onChange={v => onChange({ profile_fetch_max: v })} hint={t('로컬 캐시에 없는 프로파일을 콜렉터에서 받는 최대 수. 캐시에 있는 것은 안 셉니다')} />
      <NumberField label={t('프로파일 검색 — 시간')} value={limits.profile_budget_sec} min={5} max={120} unit={t('초')} disabled={disabled}
        onChange={v => onChange({ profile_budget_sec: v })} hint={t('넘으면 그때까지 연 것만으로 답합니다')} />
      <NumberField label={t('프로파일 검색 — 동시 수')} value={limits.profile_searches} min={1} max={8} disabled={disabled}
        onChange={v => onChange({ profile_searches: v })} hint={t('프로파일 검색을 한꺼번에 몇 개까지 돌릴지. 넘치면 앞의 것이 끝날 때까지 기다립니다')} />
    </div>
  );
}
