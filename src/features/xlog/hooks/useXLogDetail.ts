// src/features/xlog/hooks/useXLogDetail.ts
// XLog 상세 프로파일 조회 훅

import { useCallback, useState } from 'react';
import { toDateString } from '../utils/xlogDate';
import { getXLogFullProfile } from '../api/scouterApi';
import type { SXLog } from '../types/xlog';
import type { XLogProfilePack } from '../types/profile';
import { collectStepHashes } from '../types/profile';
import { useTextResolver } from './useTextResolver';

export interface XLogDetailState {
  isLoading: boolean;
  error: string | null;
  profile: XLogProfilePack | null;
  /** hash → text (서비스명, SQL, API URL, 에러 메시지 등) */
  texts: Record<number, string>;
  /** 현재 조회 중인 xlog */
  xlog: SXLog | null;
}

const INITIAL_STATE: XLogDetailState = {
  isLoading: false,
  error: null,
  profile: null,
  texts: {},
  xlog: null,
};

export function useXLogDetail() {
  const [state, setState] = useState<XLogDetailState>(INITIAL_STATE);
  const { resolve } = useTextResolver();

  const fetchDetail = useCallback(async (xlog: SXLog) => {
    setState(prev => ({ ...prev, isLoading: true, error: null, xlog }));

    try {
      const date = toDateString(xlog.endTime);
      // 상한 없는 경로를 쓴다. `TRANX_PROFILE` 은 잘릴 수 있고, 잘렸다는 표시도 없다.
      const profile = await getXLogFullProfile(xlog.txid, date, xlog.objHash);

      // Step 내 hash 수집 → 텍스트 일괄 해석
      const hashes = collectStepHashes(profile.steps);

      // **XLog 자체의 에러 해시도 넣는다.**
      // 스텝에서만 모으면 실패한 SQL·API 가 없는 트랜잭션(서비스 계층에서 난 예외)은
      // 화면에 `[0x1a2b3c]` 만 남는다 — "에러라는데 에러가 안 보인다" 가 이것이다.
      const errorHashes =
        xlog.error !== 0 && !hashes.error.includes(xlog.error)
          ? [...hashes.error, xlog.error]
          : hashes.error;
      const [methodTexts, sqlTexts, apicallTexts, errorTexts, hmsgTexts, serviceTexts] =
        await Promise.all([
          resolve('method', hashes.method),
          resolve('sql', hashes.sql),
          resolve('apicall', hashes.apicall),
          resolve('error', errorHashes),
          // HashedMessageStep 전용 타입 (ASIS TextTypes.HASH_MSG)
          resolve('hmsg', hashes.hmsg),
          // XLog 자체의 서비스명. 이걸 안 부르면 화면에 해시가 그대로 남는다.
          resolve('service', xlog.service ? [xlog.service] : []),
        ]);

      const texts: Record<number, string> = {
        ...methodTexts,
        ...sqlTexts,
        ...apicallTexts,
        ...errorTexts,
        ...hmsgTexts,
        ...serviceTexts,
      };

      setState({ isLoading: false, error: null, profile, texts, xlog });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState(prev => ({ ...prev, isLoading: false, error: msg }));
    }
  }, [resolve]);

  const clearDetail = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, fetchDetail, clearDetail };
}
