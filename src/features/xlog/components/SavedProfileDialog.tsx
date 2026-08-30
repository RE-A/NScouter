// 저장해 둔 프로파일을 고르는 창.
//
// **파일 대화상자를 쓰지 않는다.** 이 앱은 저장 위치를 스스로 정한다
// (`{data_dir}/profiles/`) — 로그와 같은 규칙이다. 그래서 «어디에 뒀더라» 가
// 생기지 않고, 목록도 그 폴더만 보면 된다.
//
// 목록은 **저장한 시각** 순이다. 트랜잭션이 일어난 시각 순이 아니다 —
// 찾는 방법이 «방금 저장한 그거» 이기 때문이다.

import { memo, useCallback, useEffect, useState } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  getProfileDir,
  listSavedProfiles,
  openSavedProfile,
  type SavedProfile,
  type SavedProfileEntry,
} from '../api/scouterApi';
import { formatTime } from '../utils/colorPalette';
import { t } from '../../../i18n';

interface SavedProfileDialogProps {
  onOpen: (saved: SavedProfile) => void;
  onClose: () => void;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; rows: SavedProfileEntry[] };

/** `2026-08-30 14:12:03` — 목록은 날짜까지 보여야 한다. 어제 것과 오늘 것이 섞인다 */
function savedAtLabel(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${formatTime(ms)}`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SavedProfileDialog = memo(function SavedProfileDialog({
  onOpen,
  onClose,
}: SavedProfileDialogProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [dir, setDir] = useState('');
  /** 여는 중인 파일. 큰 프로파일은 읽는 데 시간이 걸린다 */
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listSavedProfiles()
      .then(rows => { if (alive) setLoad({ kind: 'ok', rows }); })
      .catch((e: unknown) => { if (alive) setLoad({ kind: 'error', message: String(e) }); });
    getProfileDir()
      .then(d => { if (alive) setDir(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const open = useCallback(
    (row: SavedProfileEntry) => {
      setOpening(row.path);
      setOpenError(null);
      openSavedProfile(row.path)
        .then(saved => {
          onOpen(saved);
          onClose();
        })
        .catch((e: unknown) => {
          setOpening(null);
          setOpenError(String(e));
        });
    },
    [onOpen, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
        }}
        className="max-h-[80vh] w-[40rem] overflow-hidden rounded border border-line-strong bg-surface p-4"
      >
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-body font-semibold text-fg">{t('저장한 프로파일')}</h2>
          <button
            onClick={onClose}
            aria-label={t('닫기')}
            className="rounded px-1 text-micro text-fg-faint hover:bg-hover hover:text-fg"
          >
            ✕
          </button>
        </div>

        {/* 어디에 쌓이는지 밝힌다 — 지우는 것도 여는 것도 결국 폴더에서 한다 */}
        <p className="mb-3 flex items-center gap-2 text-micro text-fg-dim">
          <span className="truncate font-mono" title={dir}>{dir || '—'}</span>
          {dir && (
            <button
              /* `openPath` 가 아니라 `revealItemInDir` 다 — 기본 권한에 들어 있는
                 쪽이라 capability 를 넓히지 않는다. 탐색기에서 이 폴더를 짚어 준다 */
              onClick={() => { void revealItemInDir(dir).catch(() => {}); }}
              className="shrink-0 rounded border border-line px-1.5 py-0.5 hover:bg-hover hover:text-fg"
            >
              {t('폴더 열기')}
            </button>
          )}
        </p>

        {load.kind === 'loading' && (
          <p className="py-6 text-center text-body text-fg-dim">{t('조회 중…')}</p>
        )}
        {load.kind === 'error' && (
          <p className="rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
            {load.message}
          </p>
        )}
        {load.kind === 'ok' && load.rows.length === 0 && (
          <p className="py-6 text-center text-small text-fg-faint">
            {t('저장한 프로파일이 없습니다. 상세 패널의 «저장» 을 누르면 여기 쌓입니다.')}
          </p>
        )}

        {openError && (
          <p className="mb-2 rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
            {openError}
          </p>
        )}

        {load.kind === 'ok' && load.rows.length > 0 && (
          <ul className="max-h-[52vh] divide-y divide-line/40 overflow-y-auto rounded border border-line">
            {load.rows.map(row => (
              <li key={row.path}>
                <button
                  onClick={() => open(row)}
                  disabled={opening !== null}
                  className="flex w-full items-baseline gap-3 px-2 py-1.5 text-left hover:bg-hover disabled:cursor-progress"
                >
                  <span className="min-w-0 flex-1 truncate text-small text-fg" title={row.service}>
                    {row.service}
                  </span>
                  <span className="tnum shrink-0 font-mono text-micro text-fg-dim">
                    {savedAtLabel(row.saved_at)}
                  </span>
                  <span className="tnum shrink-0 font-mono text-micro text-fg-faint">
                    {sizeLabel(row.size)}
                  </span>
                  {opening === row.path && (
                    <span className="shrink-0 text-micro text-accent">{t('여는 중…')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
