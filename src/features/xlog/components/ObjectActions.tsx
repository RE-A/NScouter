// 에이전트에 **무언가를 시키는** 명령들
//
// 지금까지의 오브젝트 화면은 전부 조회였다. 여기 있는 것들은 되돌릴 수 없다 —
// GC 를 걸면 그 순간 응답이 멈추고, 힙 덤프는 힙 크기만 한 파일을 디스크에 남긴다.
//
// 그래서 위험한 것은 **두 번 눌러야** 실행된다. 모달 위에 모달을 띄우는 대신
// 버튼 자리에서 바로 되묻는다 — 확인 창이 어디서 왔는지 헷갈리지 않는다.

import { useCallback, useState } from 'react';
import {
  objectHeapDump,
  objectResetCache,
  objectStackSampling,
  objectSystemGc,
  triggerDump,
  type DumpKind,
} from '../api/scouterApi';
import { t } from '../../../i18n';

interface ObjectActionsProps {
  objHash: number;
  /** 덤프를 만든 뒤 목록을 다시 보고 싶을 때 */
  onDumpCreated?: (name: string) => void;
}

/** 스택 샘플링을 켜 두는 시간. ASIS 와 같은 5분 */
const STACK_DURATION_MS = 5 * 60 * 1000;

const DUMPS: { kind: DumpKind; label: string; desc: string }[] = [
  { kind: 'threaddump', label: t('스레드 덤프'), desc: t('지금 스택 전체를 파일로') },
  { kind: 'activeservice', label: t('액티브 서비스'), desc: t('실행 중인 트랜잭션을 파일로') },
  { kind: 'threadlist', label: t('스레드 목록'), desc: t('스레드 상태 표를 파일로') },
  { kind: 'heaphisto', label: t('힙 히스토그램'), desc: t('클래스별 점유를 파일로') },
];

export function ObjectActions({ objHash, onDumpCreated }: ObjectActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 되묻는 중인 항목. 한 번에 하나만 */
  const [confirming, setConfirming] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, fn: () => Promise<string | void>, done: string) => {
      setBusy(key);
      setError(null);
      setMessage(null);
      setConfirming(null);
      try {
        const res = await fn();
        setMessage(typeof res === 'string' && res ? res : done);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return (
    <div className="space-y-4 p-4">
      {message && (
        <p className="rounded border-l-2 border-accent bg-accent/10 px-3 py-2 text-small text-fg-muted">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded border-l-2 border-danger bg-danger/10 px-3 py-2 text-small text-danger">
          {error}
        </p>
      )}

      <Group
        title={t('덤프 만들기')}
        hint="에이전트 디스크에 파일이 생깁니다. 만든 뒤 '스레드 덤프' 화면에서 볼 수 있습니다."
      >
        {DUMPS.map(d => (
          <Action
            key={d.kind}
            label={d.label}
            desc={d.desc}
            busy={busy === d.kind}
            onRun={() =>
              run(d.kind, async () => {
                const name = await triggerDump(objHash, d.kind);
                onDumpCreated?.(name);
                return `${name} 을 만들었습니다`;
              }, '')
            }
          />
        ))}
      </Group>

      <Group title={t('스택 샘플링')} hint={t('켜 두면 5분 동안 스택을 주기적으로 모읍니다.')}>
        <Action
          label={t('켜기 (5분)')}
          desc="샘플링 시작"
          busy={busy === 'stack-on'}
          onRun={() =>
            run(
              'stack-on',
              () => objectStackSampling(objHash, STACK_DURATION_MS),
              '스택 샘플링을 켰습니다 (5분)',
            )
          }
        />
        <Action
          label={t('끄기')}
          desc="샘플링 중지"
          busy={busy === 'stack-off'}
          onRun={() =>
            run('stack-off', () => objectStackSampling(objHash), '스택 샘플링을 껐습니다')
          }
        />
      </Group>

      <Group
        title={t('되돌릴 수 없는 작업')}
        hint={t('한 번 더 눌러야 실행됩니다. 운영 중인 JVM 이면 영향이 바로 나타납니다.')}
      >
        <Action
          danger
          label="Full GC"
          desc="그 순간 응답이 멈춥니다"
          busy={busy === 'gc'}
          confirming={confirming === 'gc'}
          onAsk={() => setConfirming('gc')}
          onCancel={() => setConfirming(null)}
          onRun={() =>
            run(
              'gc',
              () => objectSystemGc(objHash),
              // 콜렉터가 성공 여부를 주지 않는다 (F-35). 한 것처럼 말하지 않는다.
              'GC 를 요청했습니다. 콜렉터가 결과를 알려주지 않으므로 Heap 카운터로 확인하세요',
            )
          }
        />
        <Action
          danger
          label={t('힙 덤프')}
          desc="힙 크기만 한 파일이 디스크에 생깁니다"
          busy={busy === 'heapdump'}
          confirming={confirming === 'heapdump'}
          onAsk={() => setConfirming('heapdump')}
          onCancel={() => setConfirming(null)}
          onRun={() => run('heapdump', () => objectHeapDump(objHash), '힙 덤프를 요청했습니다')}
        />
        <Action
          label={t('텍스트 캐시 비우기')}
          desc="해시가 이름으로 안 풀릴 때"
          busy={busy === 'reset'}
          onRun={() =>
            run(
              'reset',
              () => objectResetCache(objHash),
              '캐시를 비웠습니다. 다음 전송부터 이름이 다시 올라옵니다',
            )
          }
        />
      </Group>
    </div>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-micro tracking-wider text-fg-dim uppercase">{title}</h3>
      <p className="mt-0.5 text-micro text-fg-faint">{hint}</p>
      <div className="mt-1.5 grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {children}
      </div>
    </section>
  );
}

function Action({
  label,
  desc,
  busy,
  danger,
  confirming,
  onRun,
  onAsk,
  onCancel,
}: {
  label: string;
  desc: string;
  busy: boolean;
  danger?: boolean;
  confirming?: boolean;
  onRun: () => void;
  onAsk?: () => void;
  onCancel?: () => void;
}) {
  if (confirming) {
    return (
      <div className="flex items-center gap-2 rounded border border-danger bg-danger/10 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-small text-danger">{label} 실행할까요?</span>
        <button
          onClick={onRun}
          className="rounded bg-danger px-2 py-0.5 text-micro text-white hover:opacity-90"
        >
          실행
        </button>
        <button
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
        >
          취소
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onAsk ?? onRun}
      disabled={busy}
      className={[
        'rounded border px-3 py-2 text-left transition-colors',
        busy ? 'cursor-not-allowed border-line text-fg-faint' : 'border-line hover:bg-hover',
        danger && !busy ? 'border-danger/40' : '',
      ].join(' ')}
    >
      <span className={`block text-small ${danger ? 'text-danger' : 'text-fg'}`}>
        {busy ? '실행 중…' : label}
      </span>
      <span className="block text-micro text-fg-faint">{desc}</span>
    </button>
  );
}
