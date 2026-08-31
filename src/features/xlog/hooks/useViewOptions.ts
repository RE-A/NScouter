// 화면 표시 설정 (config.json 과 같이 사는 값)
//
// SettingsDialog 는 열릴 때만 설정을 읽는다. 표시 설정은 **화면 여기저기가 같이 봐야** 해서
// 한 곳에 모아 둔다 — 모듈 수준 저장소 하나에 담고 바뀌면 구독자에게 알린다.
//
// 컨텍스트를 쓰지 않는 이유: 이 값은 앱 전체에 하나뿐이고 거의 안 바뀐다.
// 트리 위에 Provider 를 하나 더 얹는 것보다 이쪽이 읽기 쉽다.

import { useEffect, useState } from 'react';
import { getConfig, saveConfig, type AppConfig } from '../api/scouterApi';
import { setLang, toLang, type Lang } from '../../../i18n';
import { clampMaxItems, DEFAULT_MAX_ITEMS } from '../store/XLogDataStore';

export interface ViewOptions {
  /** SQL 바인딩 파라미터를 문장에 채워 보여줄지 */
  sqlBindInline: boolean;
  /** 글자 크기 배율 */
  fontScale: number;
  /** 화면 언어 */
  lang: Lang;
  /** XLog 버퍼에 담아 둘 최대 건수 */
  bufferMax: number;
}

/** 화면에서 고를 수 있는 배율. 사이 값이 오면 가장 가까운 것으로 붙인다 */
export const FONT_SCALES = [1, 1.15, 1.3, 1.5] as const;

/**
 * 배율을 쓸 수 있는 값으로 다듬는다.
 *
 * 설정 파일을 손으로 고쳐 0 이나 음수가 들어오면 **글자가 사라진다.**
 * 파일은 사람이 여는 곳이라 여기서 막는다.
 */
export function clampFontScale(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.max(n, 0.8), 1.6);
}

/**
 * 기본값.
 *
 * **채우기가 기본이다.** `where id=?` 만 봐서는 무슨 값으로 느렸는지 알 수 없다.
 */
const DEFAULTS: ViewOptions = {
  sqlBindInline: true,
  fontScale: 1,
  lang: 'ko',
  bufferMax: DEFAULT_MAX_ITEMS,
};

let current: ViewOptions = DEFAULTS;
let loaded = false;
const listeners = new Set<(v: ViewOptions) => void>();

function emit(): void {
  applyFontScale(current.fontScale);
  // t() 는 모듈 함수라 여기서 언어를 심어 둔다. 컴포넌트마다 넘기면 빠뜨리는 자리가 생긴다.
  setLang(current.lang);
  for (const fn of listeners) fn(current);
}

function fromConfig(cfg: AppConfig): ViewOptions {
  return {
    sqlBindInline: cfg.sql_bind_inline ?? DEFAULTS.sqlBindInline,
    fontScale: clampFontScale(cfg.ui_font_scale ?? DEFAULTS.fontScale),
    lang: toLang(cfg.ui_language),
    bufferMax: clampMaxItems(cfg.xlog_buffer_max ?? DEFAULTS.bufferMax),
  };
}

/**
 * 배율을 문서 뿌리에 건다.
 *
 * 크기 토큰이 전부 `calc(px * --fs-scale)` 이라 **여기 한 곳만 바꾸면 전부 따라온다.**
 * 컴포넌트마다 곱하면 표와 차트 축이 어긋난다.
 */
function applyFontScale(v: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--fs-scale', String(v));
}

/** 설정 창이 저장한 뒤 부른다 — 다시 읽지 않고 바로 화면에 반영한다 */
export function applyConfigToViewOptions(cfg: AppConfig): void {
  current = fromConfig(cfg);
  loaded = true;
  emit();
}

/**
 * 값을 바꾸고 **config.json 까지 저장한다.**
 *
 * 화면에는 먼저 반영한다 — 저장을 기다리는 동안 스위치가 안 움직이면 고장으로 읽힌다.
 * 저장이 실패해도 이번 세션에서는 바뀐 대로 쓴다(다음 실행에 되돌아갈 뿐이다).
 */
export async function setViewOption<K extends keyof ViewOptions>(
  key: K,
  value: ViewOptions[K],
): Promise<void> {
  current = { ...current, [key]: value };
  emit();
  try {
    const cfg = await getConfig();
    await saveConfig({
      ...cfg,
      sql_bind_inline: current.sqlBindInline,
      ui_font_scale: current.fontScale,
      ui_language: current.lang,
      xlog_buffer_max: current.bufferMax,
    });
  } catch {
    // 저장 실패는 화면을 되돌릴 이유가 못 된다. 다음 실행에 기본값으로 돌아갈 뿐이다.
  }
}

export function useViewOptions(): ViewOptions {
  const [value, setValue] = useState<ViewOptions>(current);

  useEffect(() => {
    listeners.add(setValue);
    // 처음 한 번만 읽는다. 화면마다 읽으면 같은 값을 여러 번 물어보게 된다.
    if (!loaded) {
      loaded = true;
      getConfig()
        .then(cfg => {
          current = fromConfig(cfg);
          emit();
        })
        .catch(() => {});
    }
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
