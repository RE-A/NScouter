// src/features/xlog/hooks/useXLogDetail.ts
// XLog 상세 프로파일 조회 훅

import { useCallback, useState } from 'react';
import { getXLogProfile } from '../api/scouterApi';
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

/**
 * endTime을 "yyyyMMdd" 형식으로 변환
 * Scouter 서버는 날짜별로 XLog를 저장하므로 필수
 */
function toDateString(endTimeMs: number): string {
  const d = new Date(endTimeMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export function useXLogDetail() {
  const [state, setState] = useState<XLogDetailState>(INITIAL_STATE);
  const { resolve } = useTextResolver();

  const fetchDetail = useCallback(async (xlog: SXLog) => {
    setState(prev => ({ ...prev, isLoading: true, error: null, xlog }));

    try {
      const date = toDateString(xlog.endTime);
      const profile = await getXLogProfile(xlog.txid, date, xlog.objHash);

      // Step 내 hash 수집 → 텍스트 일괄 해석
      const hashes = collectStepHashes(profile.steps);
      const [methodTexts, sqlTexts, apicallTexts, errorTexts] = await Promise.all([
        resolve('method', hashes.method),
        resolve('sql', hashes.sql),
        resolve('apicall', hashes.apicall),
        resolve('error', hashes.error),
      ]);

      const texts: Record<number, string> = {
        ...methodTexts,
        ...sqlTexts,
        ...apicallTexts,
        ...errorTexts,
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
