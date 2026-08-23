// 흐름 보기용 프로파일 수집
//
// 흐름 그래프는 XLog 만으로는 못 그린다. 어느 앱이 무엇을 불렀는지는
// **각 앱의 프로파일**에 있다 (ApiCall 스텝의 txid, SQL 스텝).
//
// 트랜잭션 수만큼 왕복이 늘어나므로 **켰을 때만** 받는다.
// 상세 패널을 열 때마다 이걸 부르면 앱 전체가 느려진다.

import { useEffect, useState } from 'react';
import { getXLogFullProfile } from '../api/scouterApi';
import type { SXLog } from '../types/xlog';
import type { ProfileStep } from '../types/profile';
import { collectStepHashes } from '../types/profile';
import { yyyymmdd } from '../types/timeRange';
import { useTextResolver } from './useTextResolver';

export interface FlowProfilesState {
  loading: boolean;
  error: string | null;
  /** txid → 스텝 */
  profiles: Map<string, ProfileStep[]>;
  /** sql / apicall hash → 텍스트 */
  texts: Record<number, string>;
}

const EMPTY: FlowProfilesState = {
  loading: false,
  error: null,
  profiles: new Map(),
  texts: {},
};

export function useFlowProfiles(rows: readonly SXLog[], enabled: boolean): FlowProfilesState {
  const [state, setState] = useState<FlowProfilesState>(EMPTY);
  const { resolve } = useTextResolver();

  // 배열은 매 렌더 새 참조라 의존성으로 못 쓴다. 구성이 바뀌었을 때만 다시 받는다.
  const key = rows.map(r => r.txid).join(',');

  useEffect(() => {
    if (!enabled || rows.length === 0) {
      setState(EMPTY);
      return;
    }

    let alive = true;
    setState({ ...EMPTY, loading: true });

    (async () => {
      try {
        const packs = await Promise.all(
          rows.map(r => getXLogFullProfile(r.txid, yyyymmdd(r.endTime), r.objHash)),
        );
        if (!alive) return;

        const profiles = new Map<string, ProfileStep[]>();
        const all: ProfileStep[] = [];
        rows.forEach((r, i) => {
          profiles.set(r.txid, packs[i].steps);
          all.push(...packs[i].steps);
        });

        const hashes = collectStepHashes(all);
        const [sqlTexts, apiTexts] = await Promise.all([
          resolve('sql', hashes.sql),
          resolve('apicall', hashes.apicall),
        ]);
        if (!alive) return;

        setState({ loading: false, error: null, profiles, texts: { ...sqlTexts, ...apiTexts } });
      } catch (err) {
        if (!alive) return;
        setState({ ...EMPTY, error: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      alive = false;
    };
    // rows 자체가 아니라 구성(key)이 기준이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, resolve]);

  return state;
}
