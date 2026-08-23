// 에이전트 설정 원문 편집 (ASIS ConfigureView)
//
// **파일을 통째로 덮어쓴다.** 에이전트는 받은 텍스트를 그대로 저장하고 reload 한다 —
// 한 줄만 보내면 나머지 설정이 사라진다 (F-40). 그래서 편집 대상은 언제나 원문 전체다.
//
// 이 화면만 유일하게 **운영 중인 에이전트를 바꾼다.** 조회 화면과 같은 무게로 두면 안 된다.

import { memo, useEffect, useState } from 'react';
import { saveAgentConfig } from '../api/scouterApi';

interface ConfigEditorProps {
  objHash: number;
  objName: string;
  /** 서버에서 읽어 온 원문 */
  text: string;
  /** 저장 성공 후 다시 읽게 한다 — 저장했다는 말만 믿지 않는다 */
  onSaved: () => void;
  onCancel: () => void;
}

export const ConfigEditor = memo(function ConfigEditor({
  objHash,
  objName,
  text,
  onSaved,
  onCancel,
}: ConfigEditorProps) {
  const [draft, setDraft] = useState(text);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 서버 원문이 바뀌면(다시 읽으면) 편집 중이 아닐 때만 따라간다.
  useEffect(() => setDraft(text), [text]);

  const dirty = draft !== text;

  const save = () => {
    setBusy(true);
    setError(null);
    saveAgentConfig(objHash, draft)
      .then(() => {
        setConfirming(false);
        onSaved();
      })
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    // **높이를 명시해야 한다.** 이 창의 다른 화면은 내용이 스크롤 영역을 채워 키를 만드는데,
    // 편집기는 textarea 하나뿐이라 flex-1 만으로는 0으로 접힌다 (실제로 접혔다).
    <div className="flex min-h-[60vh] flex-1 flex-col">
      {/* **경고를 접어 두지 않는다.** 무엇이 일어나는지 모르고 누르면 안 되는 버튼이다. */}
      <p className="mx-4 mt-2 rounded border-l-2 border-warn bg-warn/10 px-2 py-1.5 text-micro text-warn">
        저장하면 <span className="font-mono">{objName}</span> 의 설정 파일이 이 내용으로{' '}
        <strong>통째로 바뀌고</strong> 에이전트가 설정을 다시 읽습니다. 지우고 저장한 줄은
        기본값으로 돌아갑니다.
      </p>

      {error && (
        <p className="mx-4 mt-2 rounded border-l-2 border-danger bg-danger/10 px-2 py-1.5 text-small text-danger">
          {error}
        </p>
      )}

      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        spellCheck={false}
        className="m-4 min-h-0 flex-1 resize-none rounded border border-line bg-base px-3 py-2 font-mono text-micro leading-relaxed text-fg outline-none focus:border-accent"
      />

      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2">
        <span className="text-micro text-fg-faint">
          {dirty ? `${draft.length.toLocaleString()}자 · 수정됨` : '수정 없음'}
        </span>
        <div className="flex-1" />

        {confirming ? (
          <>
            <span className="text-micro text-warn">정말 덮어쓸까요?</span>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
            >
              아니요
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded border border-danger px-2 py-0.5 text-micro text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              {busy ? '저장 중…' : '덮어쓰기'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onCancel}
              className="rounded px-2 py-0.5 text-micro text-fg-dim hover:bg-hover hover:text-fg"
            >
              편집 취소
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={!dirty}
              title={dirty ? undefined : '바뀐 내용이 없습니다'}
              className="rounded border border-line-strong px-2 py-0.5 text-micro text-accent hover:bg-hover disabled:cursor-not-allowed disabled:text-fg-faint"
            >
              저장…
            </button>
          </>
        )}
      </footer>
    </div>
  );
});
