// src/features/xlog/hooks/useTextResolver.ts
// hash → text 일괄 해석 훅 (캐시 포함)

import { useCallback } from 'react';
import { resolveTexts } from '../api/scouterApi';

/** 컴포넌트 생명주기 동안 유지되는 인메모리 캐시 */
const globalCache = new Map<string, string>(); // key: "typeKey:hash"

function makeCacheKey(typeKey: string, hash: number): string {
  return `${typeKey}:${hash}`;
}

export interface TextResolver {
  /**
   * 여러 hash를 한 번에 해석 후 Map<hash, text> 반환
   * 이미 캐시된 항목은 서버 요청 생략
   */
  resolve: (typeKey: string, hashes: number[]) => Promise<Record<number, string>>;
  /** 캐시에서 단건 조회 (없으면 undefined) */
  getCached: (typeKey: string, hash: number) => string | undefined;
}

export function useTextResolver(): TextResolver {
  const getCached = useCallback((typeKey: string, hash: number): string | undefined => {
    return globalCache.get(makeCacheKey(typeKey, hash));
  }, []);

  const resolve = useCallback(
    async (typeKey: string, hashes: number[]): Promise<Record<number, string>> => {
      if (hashes.length === 0) return {};

      // 캐시 미스만 서버 요청
      const missing = hashes.filter(h => !globalCache.has(makeCacheKey(typeKey, h)));

      if (missing.length > 0) {
        try {
          const result = await resolveTexts(typeKey, missing);
          for (const [hashStr, text] of Object.entries(result)) {
            globalCache.set(makeCacheKey(typeKey, Number(hashStr)), text);
          }
        } catch (err) {
          console.warn(`텍스트 해석 실패 (${typeKey}):`, err);
        }
      }

      // 전체 hashes에 대해 캐시에서 결과 수집
      const out: Record<number, string> = {};
      for (const h of hashes) {
        const cached = globalCache.get(makeCacheKey(typeKey, h));
        if (cached !== undefined) out[h] = cached;
      }
      return out;
    },
    [],
  );

  return { resolve, getCached };
}

/** 전역 캐시 초기화 (연결 해제 시 호출) */
export function clearTextCache(): void {
  globalCache.clear();
}
