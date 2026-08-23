// 오브젝트 우클릭 메뉴로 여는 조회 창 — 스레드 목록 / 환경변수
//
// ASIS 는 뷰를 새 탭으로 띄우지만, 여기서는 잠깐 보고 닫는 조회라 모달로 둔다.
// 둘 다 요청 1회로 끝나는 스냅샷이다 (스트리밍 아님).

import { useCallback, useEffect, useState } from 'react';
import {
  getAgentConfig,
  getDumpFileContent,
  getDumpFileList,
  getObjectActiveServices,
  getObjectClassList,
  getObjectEnv,
  getObjectHeapHistogram,
  getObjectList,
  getStackDump,
  getStackIndex,
  getObjectSockets,
  getObjectThreadList,
  triggerDump,
} from '../api/scouterApi';
import type {
  ActiveService,
  ClassListPage,
  DumpFile,
  EnvEntry,
  HeapHistoRow,
  LoadedClass,
  SocketInfo,
  ThreadInfo,
} from '../types/object';
import type { ConfigView as ConfigViewData } from '../types/config';
import { isBusy, threadStatTone } from '../types/object';
import { useTextResolver } from '../hooks/useTextResolver';
import { durationTone } from './durationTone';
import { filterConfig } from './configFilter';
import { ObjectActions } from './ObjectActions';
import { ThreadDetailDialog } from './ThreadDetailDialog';
import { ConfigEditor } from './ConfigEditor';
import { buildPropertyRows, type PropertyRow } from './objectProperties';
import { getAgentColor } from '../utils/colorPalette';

export type InspectKind =
  | 'active'
  | 'threads'
  | 'env'
  | 'sockets'
  | 'classes'
  | 'dump'
  | 'heap'
  | 'config'
  /** 샘플링으로 모인 스레드 스택. 켜고 끄기만 하던 것을 **읽는** 쪽 */
  | 'stack'
  /** 오브젝트 자체의 신원 — 무엇이고, 어디 있고, 언제 살아 있었나 */
  | 'properties'
  /** 조회가 아니라 **에이전트에 무언가를 시키는** 화면 */
  | 'actions';

interface ObjectInspectorProps {
  objHash: number;
  objName: string;
  kind: InspectKind;
  onClose: () => void;
}

const TITLE: Record<InspectKind, string> = {
  active: '실행 중인 트랜잭션',
  threads: '스레드 목록',
  env: '환경변수',
  sockets: '소켓',
  classes: '로드된 클래스',
  dump: '스레드 덤프',
  heap: '힙 히스토그램',
  config: '에이전트 설정',
  stack: '모인 스택',
  properties: '속성',
  actions: '에이전트 작업',
};

export function ObjectInspector({ objHash, objName, kind, onClose }: ObjectInspectorProps) {
  const [threads, setThreads] = useState<ThreadInfo[] | null>(null);
  const [env, setEnv] = useState<EnvEntry[] | null>(null);
  const [active, setActive] = useState<ActiveService[] | null>(null);
  const [sockets, setSockets] = useState<SocketInfo[] | null>(null);
  const [classes, setClasses] = useState<ClassListPage | null>(null);
  const [heap, setHeap] = useState<HeapHistoRow[] | null>(null);
  const [dumps, setDumps] = useState<DumpFile[] | null>(null);
  const [config, setConfig] = useState<ConfigViewData | null>(null);
  const [props, setProps] = useState<PropertyRow[] | null>(null);
  /** 모인 스택의 시각 목록. null 이면 아직 안 받았다 */
  const [stackTimes, setStackTimes] = useState<number[] | null>(null);
  /** 고른 한 장. null 이면 목록 화면 */
  const [stackText, setStackText] = useState<{ time: number; text: string } | null>(null);
  /** 상세를 연 액티브 서비스 행 */
  const [pickedActive, setPickedActive] = useState<ActiveService | null>(null);
  /** 설정은 표(바뀐 것 찾기)와 원문(전체 맥락)이 서로 다른 질문에 답한다 */
  const [configMode, setConfigMode] = useState<'table' | 'text'>('table');
  /** 표 기본값은 "기본값과 다른 것만" — 306개를 다 보려고 여는 창이 아니다 */
  const [changedOnly, setChangedOnly] = useState(true);
  /**
   * 설정 편집 중인가.
   *
   * **읽기가 기본이다.** 이 창의 나머지는 전부 조회인데 이것만 운영 중인 에이전트를
   * 바꾸므로, 들어가려면 한 번 더 눌러야 한다.
   */
  const [editingConfig, setEditingConfig] = useState(false);
  /** 선택한 덤프 파일의 내용. null 이면 목록 화면 */
  const [dumpText, setDumpText] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  // 응답의 service 는 **해시**다. 이름을 붙이지 않으면
  // "809ms 째 붙들고 있다"는 보이지만 **무슨 요청인지**를 알 수 없다 —
  // 이 뷰를 여는 이유가 그건데.
  const { getCached, resolve } = useTextResolver();
  const [textVersion, setTextVersion] = useState(0);

  /** service 해시를 이름으로 바꿔 둔다 (스레드/소켓 공용) */
  const resolveServices = useCallback(
    (hashes: (number | null)[]) => {
      const uniq = [...new Set(hashes.filter((h): h is number => h !== null))];
      if (uniq.length === 0) return;
      resolve('service', uniq)
        .then(() => setTextVersion(v => v + 1))
        .catch(() => {});
    },
    [resolve],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    const done = () => setLoading(false);
    const fail = (e: unknown) => setError(String(e));

    switch (kind) {
      // 조회가 아니다. 열자마자 무언가를 실행하면 안 된다.
      case 'actions':
        done();
        break;
      case 'active':
        getObjectActiveServices(objHash).then(setActive).catch(fail).finally(done);
        break;
      case 'threads':
        getObjectThreadList(objHash)
          .then(list => {
            setThreads(list);
            resolveServices(list.map(t => t.service));
          })
          .catch(fail)
          .finally(done);
        break;
      case 'env':
        getObjectEnv(objHash).then(setEnv).catch(fail).finally(done);
        break;
      case 'sockets':
        getObjectSockets(objHash)
          .then(list => {
            setSockets(list);
            resolveServices(list.map(s => s.service));
          })
          .catch(fail)
          .finally(done);
        break;
      case 'classes':
        getObjectClassList(objHash, page).then(setClasses).catch(fail).finally(done);
        break;
      case 'heap':
        getObjectHeapHistogram(objHash).then(setHeap).catch(fail).finally(done);
        break;
      case 'config':
        getAgentConfig(objHash).then(setConfig).catch(fail).finally(done);
        break;
      case 'stack':
        // 오늘 하루를 훑는다. 구간 전체 원문을 받지 않고 **시각만** 받는다 —
        // 실측에서 하루치 원문이 124장 6.4MB 였다 (F-45).
        getStackIndex(objName, dayStart(), dayStart() + DAY_MS - 1)
          .then(setStackTimes)
          .catch(fail)
          .finally(done);
        break;
      case 'properties':
        // ASIS 도 실시간에는 별도 요청을 하지 않고 **이미 받아 둔 목록**에서 꺼낸다
        // (OBJECT_INFO 는 과거 날짜 조회용이다). 같은 자료를 두 경로로 받지 않는다.
        getObjectList()
          .then(list => {
            const me = list.find(o => o.obj_hash === objHash);
            if (!me) {
              setError('목록에서 이 오브젝트를 찾지 못했습니다. 방금 내려갔을 수 있습니다.');
              return;
            }
            setProps(buildPropertyRows(me, getAgentColor(objHash)));
          })
          .catch(fail)
          .finally(done);
        break;
      case 'dump':
        // 여는 것만으로는 덤프를 뜨지 않는다 — 기존 파일 목록만 보여준다.
        // 생성은 부수효과라 사용자가 버튼을 눌러야 한다.
        getDumpFileList(objHash).then(setDumps).catch(fail).finally(done);
        break;
    }
  }, [kind, objHash, page, resolveServices]);

  /** 덤프 생성 — 에이전트에 파일이 생기는 부수효과가 있다 */
  const createDump = useCallback(() => {
    setBusy(true);
    setError(null);
    triggerDump(objHash, 'threaddump')
      .then(name =>
        getDumpFileContent(objHash, name).then(text => {
          setDumpText({ name, text });
          return getDumpFileList(objHash).then(setDumps);
        }),
      )
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  }, [objHash]);

  const openStack = useCallback(
    (time: number) => {
      setBusy(true);
      setError(null);
      getStackDump(objName, time)
        .then(text => setStackText({ time, text }))
        .catch(e => setError(String(e)))
        .finally(() => setBusy(false));
    },
    [objName],
  );

  const openDump = useCallback(
    (name: string) => {
      setBusy(true);
      setError(null);
      getDumpFileContent(objHash, name)
        .then(text => setDumpText({ name, text }))
        .catch(e => setError(String(e)))
        .finally(() => setBusy(false));
    },
    [objHash],
  );

  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = filter.trim().toLowerCase();

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-8"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line-strong bg-raised shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
          <h2 className="text-base font-medium text-fg">{TITLE[kind]}</h2>
          <span className="min-w-0 truncate text-micro text-fg-dim" title={objName}>
            {objName}
          </span>
          <div className="flex-1" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="검색"
            className="w-40 rounded border border-line-strong bg-input px-2 py-0.5 text-body text-fg placeholder:text-fg-faint"
          />
          {kind === 'config' && (
            <>
              {/* 원문에는 걸리지 않는 조건이다. 켜 두면 눌러도 아무 일이 없는 스위치가 된다 */}
              {configMode === 'table' && (
                <label
                  title="기본값 그대로인 항목은 볼 이유가 없다"
                  className="flex items-center gap-1 text-micro text-fg-dim"
                >
                  <input
                    type="checkbox"
                    checked={changedOnly}
                    onChange={e => setChangedOnly(e.target.checked)}
                    className="accent-[var(--color-accent)]"
                  />
                  바뀐 것만
                </label>
              )}
              {!editingConfig && (
                <div className="flex items-center gap-1">
                  {(['table', 'text'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setConfigMode(m)}
                      aria-pressed={configMode === m}
                      className={`rounded px-1.5 py-0.5 text-micro transition-colors ${
                        configMode === m
                          ? 'bg-accent text-white'
                          : 'text-fg-dim hover:bg-hover hover:text-fg-muted'
                      }`}
                    >
                      {m === 'table' ? '항목' : '원문'}
                    </button>
                  ))}
                </div>
              )}
              {/* 원문을 보고 있을 때만 편집으로 갈 수 있다 — 표에서는 무엇을 고칠지 정할 수 없다 */}
              {!editingConfig && configMode === 'text' && config?.text && (
                <button
                  onClick={() => setEditingConfig(true)}
                  title="설정 파일을 통째로 바꿉니다"
                  className="rounded border border-line-strong px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
                >
                  편집
                </button>
              )}
            </>
          )}
          {kind === 'stack' && stackText && (
            <>
              <span className="font-mono text-micro text-fg-dim">
                {stackTimeLabel(stackText.time)}
              </span>
              <button
                onClick={() => setStackText(null)}
                className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
              >
                ← 목록
              </button>
            </>
          )}
          {kind === 'dump' && dumpText && (
            <button
              onClick={() => setDumpText(null)}
              className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
            >
              ← 목록
            </button>
          )}
          {kind === 'dump' && !dumpText && (
            // **부수효과가 있는 버튼이다** — 에이전트에 파일이 생긴다. 그래서 문구를 명령형으로 둔다.
            <button
              onClick={createDump}
              disabled={busy}
              title="대상 JVM 의 스레드 덤프를 지금 떠서 에이전트에 파일로 남깁니다"
              className={`rounded border border-line-strong px-2 py-0.5 text-micro ${
                busy ? 'cursor-not-allowed text-fg-faint' : 'text-accent hover:bg-hover'
              }`}
            >
              {busy ? '뜨는 중…' : '지금 덤프 뜨기'}
            </button>
          )}
          {/* 스냅샷이라 자동 갱신하지 않는다 — 다시 보려면 눌러야 한다 */}
          <button
            onClick={load}
            title="다시 조회"
            className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
          >
            새로고침
          </button>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded px-1.5 text-fg-dim hover:text-fg"
          >
            ✕
          </button>
        </header>

        {/* 편집은 스크롤 영역 밖에 둔다 — textarea 가 남은 높이를 다 써야 한다 */}
        {kind === 'config' && editingConfig && config && (
          <ConfigEditor
            objHash={objHash}
            objName={objName}
            text={config.text}
            onSaved={() => {
              // **저장했다는 말만 믿지 않는다.** 다시 읽어 화면을 서버 상태로 맞춘다.
              setEditingConfig(false);
              load();
            }}
            onCancel={() => setEditingConfig(false)}
          />
        )}

        <div className={`min-h-0 flex-1 overflow-auto ${kind === 'config' && editingConfig ? 'hidden' : ''}`}>
          {kind === 'actions' && <ObjectActions objHash={objHash} />}
          {kind !== 'actions' && loading && <Note>조회 중…</Note>}
          {kind !== 'actions' && error && <Note tone="danger">{error}</Note>}
          {!loading && !error && kind === 'active' && (
            <ActiveTable
              rows={(active ?? []).filter(
                a =>
                  !q ||
                  a.service.toLowerCase().includes(q) ||
                  a.name.toLowerCase().includes(q) ||
                  a.sql.toLowerCase().includes(q),
              )}
              onPick={setPickedActive}
            />
          )}
          {!loading && !error && kind === 'threads' && (
            <ThreadTable
              rows={(threads ?? []).filter(t =>
                matchThread(t, q, t.service === null ? undefined : getCached('service', t.service)),
              )}
              serviceName={h => getCached('service', h)}
              textVersion={textVersion}
            />
          )}
          {!loading && !error && kind === 'env' && (
            <EnvTable
              rows={(env ?? []).filter(
                e => !q || e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q),
              )}
            />
          )}
          {!loading && !error && kind === 'sockets' && (
            <SocketTable
              rows={(sockets ?? []).filter(
                s => !q || s.host.includes(q) || String(s.port).includes(q),
              )}
              serviceName={h => getCached('service', h)}
              textVersion={textVersion}
            />
          )}
          {!loading && !error && kind === 'heap' && (
            <HeapTable
              rows={(heap ?? []).filter(r => !q || r.class_name.toLowerCase().includes(q))}
            />
          )}
          {!loading && !error && kind === 'dump' && (
            dumpText ? (
              <pre className="px-4 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap text-fg">
                {dumpText.text}
              </pre>
            ) : (
              <DumpFileTable rows={dumps ?? []} onOpen={openDump} busy={busy} />
            )
          )}
          {!loading && !error && kind === 'stack' && (
            stackText ? (
              <pre className="px-4 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap text-fg">
                {stackText.text}
              </pre>
            ) : (
              <StackTimeTable
                times={(stackTimes ?? []).filter(t => !q || stackTimeLabel(t).includes(q))}
                onOpen={openStack}
                busy={busy}
              />
            )
          )}
          {!loading && !error && kind === 'properties' && (
            <PropertyTable
              rows={(props ?? []).filter(
                r => !q || r.key.toLowerCase().includes(q) || r.value.toLowerCase().includes(q),
              )}
            />
          )}
          {!loading && !error && kind === 'config' && !editingConfig && (
            <ConfigPane
              data={config}
              mode={configMode}
              changedOnly={changedOnly}
              query={q}
            />
          )}
          {!loading && !error && kind === 'classes' && (
            <ClassTable
              rows={(classes?.classes ?? []).filter(
                c =>
                  !q ||
                  c.name.toLowerCase().includes(q) ||
                  c.resource.toLowerCase().includes(q),
              )}
            />
          )}
        </div>

        {/* 클래스 목록만 페이지 단위다. 검색은 **현재 페이지 안에서만** 걸린다 —
            17,000개를 다 받아 거르면 조회가 171번 왕복한다. */}
        {kind === 'classes' && classes && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-1.5">
            <span className="text-micro text-fg-dim">
              <span className="tnum font-mono text-fg-muted">{classes.page}</span>
              <span className="text-fg-faint">/{classes.total_page}</span> 페이지
              {q && <span className="text-fg-faint"> · 검색은 이 페이지 안에서만</span>}
            </span>
            <div className="flex-1" />
            <PageBtn disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              이전
            </PageBtn>
            <PageBtn
              disabled={page >= classes.total_page}
              onClick={() => setPage(p => Math.min(classes.total_page, p + 1))}
            >
              다음
            </PageBtn>
          </footer>
        )}
      </div>

      {pickedActive?.txid && (
        <ThreadDetailDialog
          objHash={objHash}
          threadId={pickedActive.id}
          txid={pickedActive.txid}
          service={pickedActive.service || pickedActive.name}
          objName={objName}
          onClose={() => setPickedActive(null)}
        />
      )}
    </div>
  );
}

function PageBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded border border-line-strong px-2 py-0.5 text-micro ${
        disabled ? 'cursor-not-allowed text-fg-faint' : 'text-fg-muted hover:bg-hover hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

// "무슨 요청을 처리 중인 스레드인가" 로 찾는 게 가장 흔하므로 서비스명도 검색 대상이다.
function matchThread(t: ThreadInfo, q: string, service?: string): boolean {
  if (!q) return true;
  return (
    t.name.toLowerCase().includes(q) ||
    t.stat.toLowerCase().includes(q) ||
    (service?.toLowerCase().includes(q) ?? false)
  );
}

const THREAD_COLS =
  'grid grid-cols-[56px_minmax(0,1fr)_112px_72px_80px] items-baseline gap-x-3 px-4';

function ThreadTable({
  rows,
  serviceName,
}: {
  rows: ThreadInfo[];
  serviceName: (hash: number) => string | undefined;
  /** 값은 안 쓰고, 텍스트 캐시가 채워졌을 때 다시 그리기 위한 신호다 */
  textVersion?: number;
}) {
  if (rows.length === 0) return <Note>스레드가 없습니다.</Note>;

  // 일하는 스레드를 위로. 스레드 목록을 여는 이유가 "지금 뭐가 도는가" 다.
  const sorted = [...rows].sort((a, b) => {
    if (isBusy(a) !== isBusy(b)) return isBusy(a) ? -1 : 1;
    return (b.elapsed ?? 0) - (a.elapsed ?? 0);
  });

  return (
    <div>
      <div
        className={`${THREAD_COLS} sticky top-0 border-b border-line bg-raised py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        <span className="text-right">ID</span>
        <span>이름</span>
        <span>상태</span>
        <span className="text-right">CPU</span>
        <span className="text-right">Elapsed</span>
      </div>
      <ol className="divide-y divide-line/40">
        {sorted.map(t => (
          <li
            key={t.id}
            className={`${THREAD_COLS} border-l-2 py-1 text-body ${
              isBusy(t) ? 'border-l-accent bg-accent/8' : 'border-l-transparent'
            }`}
          >
            <span className="tnum text-right font-mono text-micro text-fg-faint">{t.id}</span>
            <span className="min-w-0">
              <span className="block truncate text-fg" title={t.name}>
                {t.name}
              </span>
              {/* 처리 중인 요청. 유휴 스레드에는 없다 */}
              {t.service !== null && (
                <span
                  className="block truncate font-mono text-micro text-accent"
                  title={serviceName(t.service) ?? `0x${(t.service >>> 0).toString(16)}`}
                >
                  {serviceName(t.service) ?? `0x${(t.service >>> 0).toString(16)}`}
                </span>
              )}
            </span>
            <span className={`font-mono text-micro ${threadStatTone(t.stat)}`}>{t.stat}</span>
            <span className="tnum text-right font-mono text-micro text-fg-muted">
              {t.cpu.toLocaleString()}
            </span>
            <span className="tnum text-right font-mono text-micro text-fg">
              {t.elapsed === null ? '' : `${t.elapsed.toLocaleString()}ms`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * 속성 표. ASIS 와 같은 두 열(Property / Value)이다.
 *
 * tags 에서 온 줄은 흐리게 눕힌다 — 고정 항목은 어느 오브젝트에나 있지만
 * tags 는 에이전트마다 다르다. 섞어 놓으면 "이 항목이 왜 저기엔 없지"를 매번 묻게 된다.
 */
const DAY_MS = 86_400_000;

/** 오늘 자정 (로컬). 콜렉터는 epoch ms 로 구간을 받는다 */
function dayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function stackTimeLabel(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 모인 스택의 시각 목록.
 *
 * **최신이 위다.** 스택을 뒤지는 이유는 대개 방금 무슨 일이 있었나이고,
 * 오름차순이면 그게 스크롤 맨 아래에 있다.
 */
function StackTimeTable({
  times,
  onOpen,
  busy,
}: {
  times: number[];
  onOpen: (time: number) => void;
  busy: boolean;
}) {
  if (times.length === 0) {
    return (
      <Note>
        모인 스택이 없습니다.
        <br />
        <span className="text-micro">
          «에이전트 작업 → 스택 샘플링»을 켜면 10초 간격으로 쌓입니다.
        </span>
      </Note>
    );
  }
  return (
    <ul className="divide-y divide-line/40">
      {[...times].reverse().map(t => (
        <li key={t}>
          <button
            disabled={busy}
            onClick={() => onOpen(t)}
            className="grid w-full grid-cols-[110px_minmax(0,1fr)] items-baseline gap-x-3 px-4 py-1 text-left hover:bg-hover disabled:opacity-50"
          >
            <span className="font-mono text-micro text-fg">{stackTimeLabel(t)}</span>
            <span className="text-micro text-fg-faint">열기</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PropertyTable({ rows }: { rows: PropertyRow[] }) {
  if (rows.length === 0) return <Note>항목이 없습니다.</Note>;
  return (
    <dl className="divide-y divide-line/40">
      {rows.map(r => (
        <div
          key={r.key}
          className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-4 px-4 py-1"
        >
          <dt
            className={`truncate font-mono text-micro ${r.fromTags ? 'text-fg-faint' : 'text-fg-muted'}`}
            title={r.fromTags ? `${r.key} (에이전트 tag)` : r.key}
          >
            {r.key}
          </dt>
          <dd className="flex items-center gap-2 font-mono text-micro break-all text-fg">
            {r.isColor && (
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-sm border border-line"
                style={{ background: r.value }}
              />
            )}
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EnvTable({ rows }: { rows: EnvEntry[] }) {
  if (rows.length === 0) return <Note>항목이 없습니다.</Note>;
  return (
    <dl className="divide-y divide-line/40">
      {rows.map(e => (
        <div
          key={e.key}
          className="grid grid-cols-[minmax(0,260px)_minmax(0,1fr)] gap-x-4 px-4 py-1"
        >
          <dt className="truncate font-mono text-micro text-fg-muted" title={e.key}>
            {e.key}
          </dt>
          <dd className="font-mono text-micro break-all text-fg">{e.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const HEAP_COLS =
  'grid grid-cols-[44px_minmax(0,1fr)_104px_120px] items-baseline gap-x-3 px-4';

/** 7,000행이 온다. 전부 그리면 창이 멈추므로 상위만 보여주고 나머지는 검색으로 찾게 한다. */
const HEAP_VISIBLE = 300;

function HeapTable({ rows }: { rows: HeapHistoRow[] }) {
  if (rows.length === 0) {
    return (
      <Note>
        히스토그램이 비었습니다. 앱 컨테이너가 JRE 면 <code>jdk.attach</code> 가 없어 빈 결과가
        옵니다.
      </Note>
    );
  }

  // 응답은 이미 바이트 내림차순이지만, 검색으로 걸러도 순서가 유지되게 다시 정렬한다.
  const sorted = [...rows].sort((a, b) => b.bytes - a.bytes);
  const shown = sorted.slice(0, HEAP_VISIBLE);
  const total = rows.reduce((s, r) => s + r.bytes, 0);

  return (
    <div>
      <div
        className={`${HEAP_COLS} sticky top-0 border-b border-line bg-raised py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        <span className="text-right">#</span>
        <span>클래스</span>
        <span className="text-right">인스턴스</span>
        <span className="text-right">바이트</span>
      </div>
      <ol className="divide-y divide-line/40">
        {shown.map(r => (
          <li key={`${r.rank}-${r.class_name}`} className={`${HEAP_COLS} py-1`}>
            <span className="tnum text-right font-mono text-micro text-fg-faint">{r.rank}</span>
            <span className="truncate font-mono text-body text-fg" title={r.class_name}>
              {r.class_name}
            </span>
            <span className="tnum text-right font-mono text-micro text-fg-muted">
              {r.instances.toLocaleString()}
            </span>
            <span className="tnum text-right font-mono text-micro text-fg">
              {r.bytes.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>
      <p className="px-4 py-2 text-micro text-fg-faint">
        {rows.length.toLocaleString()}개 클래스 · 합계 {total.toLocaleString()} B
        {rows.length > HEAP_VISIBLE && ` · 상위 ${HEAP_VISIBLE}개만 표시 (검색으로 좁히세요)`}
      </p>
    </div>
  );
}

function DumpFileTable({
  rows,
  onOpen,
  busy,
}: {
  rows: DumpFile[];
  onOpen: (name: string) => void;
  busy: boolean;
}) {
  if (rows.length === 0) {
    return <Note>저장된 덤프가 없습니다. 위의 &ldquo;지금 덤프 뜨기&rdquo;를 누르세요.</Note>;
  }
  return (
    <ol className="divide-y divide-line/40">
      {rows.map(f => (
        <li key={f.name}>
          <button
            disabled={busy}
            onClick={() => onOpen(f.name)}
            className="grid w-full grid-cols-[minmax(0,1fr)_96px_140px] items-baseline gap-x-3 px-4 py-1 text-left hover:bg-hover/60 disabled:cursor-not-allowed"
          >
            <span className="truncate font-mono text-body text-fg" title={f.name}>
              {f.name}
            </span>
            <span className="tnum text-right font-mono text-micro text-fg-muted">
              {f.size.toLocaleString()} B
            </span>
            <span className="tnum text-right font-mono text-micro text-fg-faint">
              {new Date(f.last_modified).toLocaleString('ko-KR', { hour12: false })}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

const ACTIVE_COLS =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,170px)_104px_80px] items-baseline gap-x-3 px-4';

function ActiveTable({
  rows,
  onPick,
}: {
  rows: ActiveService[];
  onPick: (row: ActiveService) => void;
}) {
  if (rows.length === 0) {
    // 부하가 없으면 0건이 정상이다. 고장으로 읽히지 않게 말해 준다.
    return <Note>지금 실행 중인 트랜잭션이 없습니다.</Note>;
  }

  // 오래 붙들고 있는 것부터. 이 화면을 여는 이유가 "뭐가 안 끝나나" 다.
  const sorted = [...rows].sort((a, b) => b.elapsed - a.elapsed);

  return (
    <div>
      <div
        className={`${ACTIVE_COLS} sticky top-0 border-b border-line bg-raised py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        <span>서비스</span>
        <span>스레드</span>
        <span>상태</span>
        <span className="text-right">Elapsed</span>
      </div>
      <ol className="divide-y divide-line/40">
        {sorted.map(a => (
          <li
            key={`${a.id}-${a.txid ?? a.service}`}
            // txid 가 없으면 상세를 물을 수 없다. 눌러도 빈 창이면 고장으로 읽힌다.
            onClick={a.txid ? () => onPick(a) : undefined}
            title={a.txid ? '스택 트레이스 보기' : undefined}
            className={`${ACTIVE_COLS} py-1 text-body ${a.txid ? 'cursor-pointer hover:bg-hover/60' : ''}`}
          >
            <span className="min-w-0">
              <span className="block truncate text-fg" title={a.service}>
                {a.service}
              </span>
              {/* 지금 붙들고 있는 게 SQL 인지 외부 호출인지가 원인 판단의 핵심이다 */}
              {a.sql && (
                <span className="block truncate font-mono text-micro text-[var(--cat-sql)]" title={a.sql}>
                  {a.sql}
                </span>
              )}
              {a.subcall && (
                <span
                  className="block truncate font-mono text-micro text-[var(--cat-api)]"
                  title={a.subcall}
                >
                  {a.subcall}
                </span>
              )}
            </span>
            <span className="truncate font-mono text-micro text-fg-muted" title={a.name}>
              {a.name}
            </span>
            <span className={`font-mono text-micro ${threadStatTone(a.stat)}`}>{a.stat}</span>
            <span className={`tnum text-right font-mono ${durationTone(a.elapsed)}`}>
              {a.elapsed.toLocaleString()}ms
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const SOCKET_COLS = 'grid grid-cols-[minmax(0,1fr)_72px_64px_minmax(0,200px)] items-baseline gap-x-3 px-4';

function SocketTable({
  rows,
  serviceName,
}: {
  rows: SocketInfo[];
  serviceName: (hash: number) => string | undefined;
  textVersion?: number;
}) {
  if (rows.length === 0) return <Note>열린 소켓이 없습니다.</Note>;

  // 같은 상대로 많이 열린 것부터. 커넥션 풀이 새는지 보려고 여는 화면이다.
  const sorted = [...rows].sort((a, b) => b.count - a.count);

  return (
    <div>
      <div
        className={`${SOCKET_COLS} sticky top-0 border-b border-line bg-raised py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        <span>상대 주소</span>
        <span className="text-right">Port</span>
        <span className="text-right">개수</span>
        <span>트랜잭션</span>
      </div>
      <ol className="divide-y divide-line/40">
        {sorted.map(s => (
          <li key={s.key} className={`${SOCKET_COLS} py-1 text-body`}>
            <span className="truncate font-mono text-fg">{s.host}</span>
            <span className="tnum text-right font-mono text-micro text-fg-muted">{s.port}</span>
            <span className="tnum text-right font-mono text-micro text-fg-muted">
              {s.count.toLocaleString()}
            </span>
            <span className="truncate font-mono text-micro text-accent">
              {s.service === null ? '' : (serviceName(s.service) ?? `0x${(s.service >>> 0).toString(16)}`)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const CLASS_COLS = 'grid grid-cols-[minmax(0,1fr)_minmax(0,240px)] items-baseline gap-x-4 px-4';

function ClassTable({ rows }: { rows: LoadedClass[] }) {
  if (rows.length === 0) return <Note>클래스가 없습니다.</Note>;
  return (
    <div>
      <div
        className={`${CLASS_COLS} sticky top-0 border-b border-line bg-raised py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        <span>클래스</span>
        <span>출처</span>
      </div>
      <ol className="divide-y divide-line/40">
        {rows.map(c => (
          <li key={`${c.index}-${c.name}`} className={`${CLASS_COLS} py-1`}>
            <span className="min-w-0">
              <span className="block truncate font-mono text-body text-fg" title={c.name}>
                {c.name}
              </span>
              {c.super_class && (
                <span
                  className="block truncate font-mono text-micro text-fg-faint"
                  title={c.super_class}
                >
                  ← {c.super_class}
                </span>
              )}
            </span>
            <span className="truncate font-mono text-micro text-fg-muted" title={c.resource}>
              {c.resource}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const CONFIG_COLS = 'grid grid-cols-[minmax(0,300px)_minmax(0,1fr)] gap-x-4 px-4';

function ConfigPane({
  data,
  mode,
  changedOnly,
  query,
}: {
  data: ConfigViewData | null;
  mode: 'table' | 'text';
  changedOnly: boolean;
  query: string;
}) {
  if (!data) return <Note>설정을 불러오지 못했습니다.</Note>;

  if (mode === 'text') {
    // 설정 파일이 없어도 에이전트는 기본값으로 돈다. 원문만 비는 게 정상일 수 있다.
    if (!data.text) {
      return <Note>설정 파일이 없습니다. 에이전트가 기본값으로 동작 중입니다.</Note>;
    }
    return (
      <pre className="px-4 py-2 font-mono text-micro leading-relaxed whitespace-pre-wrap text-fg">
        {data.text}
      </pre>
    );
  }

  const rows = filterConfig(data.entries, query, changedOnly);
  const changed = data.entries.filter(e => e.changed).length;

  return (
    <div>
      <div
        className={`${CONFIG_COLS} sticky top-0 border-b border-line bg-raised py-1 text-micro font-medium tracking-wide text-fg-faint uppercase`}
      >
        <span>키</span>
        <span>값</span>
      </div>
      {rows.length === 0 ? (
        <Note>
          {changedOnly && changed === 0
            ? '기본값과 다른 설정이 없습니다.'
            : '조건에 맞는 항목이 없습니다.'}
        </Note>
      ) : (
        <ol className="divide-y divide-line/40">
          {rows.map(e => (
            <li
              key={e.key}
              className={`${CONFIG_COLS} border-l-2 py-1 ${
                e.changed ? 'border-l-accent bg-accent/8' : 'border-l-transparent'
              }`}
            >
              <span className="truncate font-mono text-micro text-fg-muted" title={e.key}>
                {e.key}
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-micro break-all text-fg">
                  {e.value || <span className="text-fg-faint">(비어 있음)</span>}
                </span>
                {/* 바뀐 항목에서만 기본값을 보여준다 — 같은 값을 두 번 쓰면 표가 안 읽힌다 */}
                {e.changed && (
                  <span className="block font-mono text-micro break-all text-fg-faint">
                    기본 {e.default || '(비어 있음)'}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="px-4 py-2 text-micro text-fg-faint">
        전체 {data.entries.length.toLocaleString()}개 · 기본값과 다른 항목 {changed}개
      </p>
    </div>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <p className={`px-4 py-8 text-center text-small ${tone ? 'text-danger' : 'text-fg-faint'}`}>
      {children}
    </p>
  );
}
