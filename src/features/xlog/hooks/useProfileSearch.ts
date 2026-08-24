// 프로파일 본문 검색 진행 (묶음 + 진행률 + 취소)
//
// 트랜잭션 한 건이 요청 하나다. 드래그 한 번에 수백 건이 잡히므로
// **한 번에 다 부르면 몇 초 동안 화면이 아무 말도 못 한다.**
// 묶음으로 잘라 부르고, 사이마다 진행률을 올리고 중단 신호를 본다.

import { useCallback, useRef, useState } from 'react';
import { searchProfiles, type ProfileHit, type SearchTarget } from '../api/scouterApi';

/**
 * 한 번에 보낼 건수.
 *
 * 크면 진행률이 뚝뚝 끊기고 취소가 늦게 듣는다. 작으면 IPC 왕복이 늘어난다.
 *
 * 백엔드가 묶음 하나를 워커 8개로 나눠 받으므로(SEARCH_WORKERS) **묶음이 작으면
 * 워커가 놀고 IPC 왕복만 남는다.** 100건이면 워커당 12~13건,
 * 로컬 콜렉터에서 대략 0.1초 — 진행률도 끊기지 않고 취소도 그 안에 듣는다.
 */
const BATCH = 100;

export interface SearchProgress {
  /** 훑은 건수 */
  done: number;
  /** 전체 대상 */
  total: number;
  /** 프로파일을 못 가져온 건수 */
  failed: number;
}

export interface ProfileSearchState {
  running: boolean;
  /** 검색이 끝났거나 진행 중인 결과. 들어오는 대로 쌓인다 */
  hits: ProfileHit[];
  progress: SearchProgress | null;
  error: string | null;
  /** 마지막으로 실행한 검색어. 결과가 무엇에 대한 것인지 화면이 말할 근거 */
  query: string;
}

const IDLE: ProfileSearchState = {
  running: false,
  hits: [],
  progress: null,
  error: null,
  query: '',
};

export function useProfileSearch() {
  const [state, setState] = useState<ProfileSearchState>(IDLE);
  /** 중단 신호. 진행 중인 묶음은 끝내고 다음 묶음부터 멈춘다 */
  const cancelRef = useRef(false);
  /** 실행 세대. 이전 검색의 늦은 응답이 새 결과를 덮지 않게 한다 */
  const genRef = useRef(0);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = true;
    genRef.current += 1;
    setState(IDLE);
  }, []);

  const run = useCallback(async (targets: SearchTarget[], query: string) => {
    const q = query.trim();
    if (q === '' || targets.length === 0) return;

    cancelRef.current = false;
    const gen = ++genRef.current;

    setState({
      running: true,
      hits: [],
      progress: { done: 0, total: targets.length, failed: 0 },
      error: null,
      query: q,
    });

    let done = 0;
    let failed = 0;

    try {
      for (let i = 0; i < targets.length; i += BATCH) {
        if (cancelRef.current || gen !== genRef.current) break;

        const batch = targets.slice(i, i + BATCH);
        const res = await searchProfiles(batch, q);
        if (gen !== genRef.current) return;

        done += batch.length;
        failed += res.failed;

        setState(prev => ({
          ...prev,
          hits: res.hits.length > 0 ? [...prev.hits, ...res.hits] : prev.hits,
          progress: { done, total: targets.length, failed },
        }));
      }
    } catch (e) {
      if (gen !== genRef.current) return;
      setState(prev => ({ ...prev, running: false, error: String(e) }));
      return;
    }

    if (gen !== genRef.current) return;
    setState(prev => ({ ...prev, running: false }));
  }, []);

  return { state, run, cancel, reset };
}
